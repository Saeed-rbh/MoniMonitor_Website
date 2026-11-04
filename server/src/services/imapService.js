const { recordAgentState } = require('./operationalStatus');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

let dbService = null;
function getDbService() {
    if (!dbService) dbService = require('../database/dbService');
    return dbService;
}

const RETRY_UNSEEN_INTERVAL_MS = 60 * 1000;

class ImapService {
    constructor(host, port, user, password, onNewEmail) {
        this.host = host;
        this.port = port;
        this.user = user;
        this.password = password;
        this.onNewEmail = onNewEmail;
        this.reconnectTimeout = null;
        this.reconnectDelay = 5000;
        this.lock = null;
        this.retryUnseenInterval = null;
        this.processingUnseen = null;
        this.client = this._createClient();

        // Graceful shutdown: release lock and logout on Ctrl+C or system kill
        const cleanup = async () => {
            console.log('\nShutting down IMAP client gracefully...');
            if (this.retryUnseenInterval) clearInterval(this.retryUnseenInterval);
            if (this.lock) { try { this.lock.release(); } catch(e) {} }
            if (this.client.usable) { try { await this.client.logout(); } catch(e) {} }
            process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    }

    _createClient() {
        return new ImapFlow({
            host: this.host,
            port: this.port,
            secure: true,
            auth: {
                user: this.user,
                pass: this.password
            },
            logger: false
        });
    }

    async start() {
        try {
            console.log('Connecting to IMAP server...');
            await this.client.connect();
            console.log('Connected to email!');
            await recordAgentState({ connected: true, lastError: null });

            this.lock = await this.client.getMailboxLock('INBOX');
            try {
                // Process existing unseen emails on startup
                await this.processUnseen();
                this.startRetryPolling();

                console.log("Listening for new emails in INBOX...");
                
                this.client.on('exists', async () => {
                    console.log("New email arrived! Processing...");
                    await this.processUnseen();
                });

                this.client.on('error', err => {
                    console.error("IMAP Error:", err);
                    this.handleReconnect();
                });

                this.client.on('close', () => {
                    console.log("IMAP Connection Closed");
                    this.handleReconnect();
                });

            } catch (err) {
                await recordAgentState({ connected: false, lastError: 'Unable to open the email inbox' }).catch(() => {});
                this.handleReconnect();
                console.error("Error setting up inbox:", err);
                if (this.lock) { try { this.lock.release(); } catch(e) {} }
            }
        } catch (err) {
            await recordAgentState({ connected: false, lastError: 'Unable to connect to the email mailbox' }).catch(() => {});
            console.error("Failed to connect to IMAP server:", err);
            this.handleReconnect();
        }
    }

    async processOne(uid) {
        const database = getDbService();
        const db = await database.getDb();
        const sourceKey = JSON.stringify([this.host, this.user, 'INBOX', String(this.client.mailbox.uidValidity), uid]);
        let job = await db.get('SELECT * FROM email_ingestion WHERE sourceKey = ?', [sourceKey]);
        if (job && job.status !== 'pending') return;
        if (!job) {
            // Upgrade the old single-mailbox UID journal only for its first observed epoch.
            // Subsequent UIDVALIDITY changes cannot reuse these unscoped legacy IDs.
            const scope = JSON.stringify([this.host, this.user, 'INBOX', String(this.client.mailbox.uidValidity)]);
            await db.run("INSERT OR IGNORE INTO email_sync_state (key, value) VALUES ('legacyScope', ?)", [scope]);
            const legacy = await db.get("SELECT value FROM email_sync_state WHERE key = 'legacyScope'");
            if (legacy.value === scope && await database.isEmailProcessed(uid)) {
                await db.run(`INSERT OR IGNORE INTO email_ingestion
                    (sourceKey, body, receivedAt, status, updatedAt) VALUES (?, '', ?, 'legacy_applied', ?)`,
                    [sourceKey, new Date().toISOString(), new Date().toISOString()]);
                return;
            }
            const message = await this.client.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
            if (!message?.source) return;
            const mail = await simpleParser(message.source);
            const receivedAt = new Date(message.internalDate || mail.date || Date.now()).toISOString();
            await db.run(`INSERT OR IGNORE INTO email_ingestion
                (sourceKey, body, receivedAt, updatedAt) VALUES (?, ?, ?, ?)`,
                [sourceKey, `From: ${mail.from?.text || ''}\nSubject: ${(mail.subject || '').replace(/[\r\n]/g, ' ')}\n\n${mail.text || mail.html || ''}`, receivedAt, new Date().toISOString()]);
            await recordAgentState({ lastMessageAt: new Date().toISOString() });
        }
        await this.processJob(sourceKey);
    }

    async processJob(sourceKey) {
        const db = await getDbService().getDb();
        const job = await db.get('SELECT * FROM email_ingestion WHERE sourceKey = ?', [sourceKey]);
        if (!job || job.status !== 'pending') return;
        await db.run('UPDATE email_ingestion SET attempts = attempts + 1, updatedAt = ? WHERE sourceKey = ?', [new Date().toISOString(), sourceKey]);
        try {
            const success = await this.onNewEmail(job.body, sourceKey, job.receivedAt);
            await db.run(`UPDATE email_ingestion SET status = ?, lastError = ?, updatedAt = ? WHERE sourceKey = ? AND status = 'pending'`,
                [success ? 'applied' : 'pending', success ? null : 'Processing failed; retry scheduled',
                    new Date().toISOString(), sourceKey]);
        } catch (error) {
            await db.run(`UPDATE email_ingestion SET lastError = ?,
                updatedAt = ? WHERE sourceKey = ?`, [error.message, new Date().toISOString(), sourceKey]);
        }
    }

    async processUnseen() {
        if (this.processingUnseen) return this.processingUnseen;

        this.processingUnseen = this.processUnseenBatch();
        try {
            return await this.processingUnseen;
        } finally {
            this.processingUnseen = null;
        }
    }

    async processUnseenBatch() {
        try {
            // Scan all UIDs, including read messages. Only fetch bodies not already in our journal.
            // Persisted jobs survive restarts and messages being deleted or moved out of INBOX.
            const db = await getDbService().getDb();
            const pending = await db.all("SELECT sourceKey FROM email_ingestion WHERE status = 'pending'");
            for (const job of pending) await this.processJob(job.sourceKey);
            const messages = await this.client.search({ all: true }, { uid: true });
            const retried = new Set(pending.map(job => job.sourceKey));
            for (const uid of messages) {
                const key = JSON.stringify([this.host, this.user, 'INBOX', String(this.client.mailbox.uidValidity), uid]);
                if (!retried.has(key)) await this.processOne(uid);
            }

            await recordAgentState({ lastScanAt: new Date().toISOString(), lastError: null });
        } catch (err) {
            await recordAgentState({ lastError: 'Email scan failed; automatic retry scheduled' }).catch(() => {});
            console.error("Error processing unseen messages:", err);
        }
    }

    startRetryPolling() {
        if (this.retryUnseenInterval) clearInterval(this.retryUnseenInterval);
        this.retryUnseenInterval = setInterval(() => {
            this.processUnseen().catch((error) => {
                console.error('Error retrying unseen messages:', error);
            });
        }, RETRY_UNSEEN_INTERVAL_MS);
        this.retryUnseenInterval.unref?.();
    }

    handleReconnect() {
        recordAgentState({ connected: false, lastError: 'Mailbox disconnected; reconnecting automatically' }).catch(() => {});
        if (this.reconnectTimeout) return;
        if (this.retryUnseenInterval) {
            clearInterval(this.retryUnseenInterval);
            this.retryUnseenInterval = null;
        }
        console.log(`Attempting to reconnect in ${this.reconnectDelay / 1000}s...`);
        this.reconnectTimeout = setTimeout(async () => {
            this.reconnectTimeout = null;
            // Create a fresh ImapFlow instance — old ones cannot be reused after disconnect
            this.client = this._createClient();
            // Exponential backoff: double the delay each attempt, cap at 5 minutes
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5 * 60 * 1000);
            await this.start();
        }, this.reconnectDelay);
    }
}

module.exports = { ImapService };
