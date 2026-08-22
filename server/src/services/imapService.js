const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

let dbService = null;
function getDbService() {
    if (!dbService) dbService = require('../database/dbService');
    return dbService;
}

const CONCURRENCY = 3;
const RETRY_INTERVAL_MS = 60 * 1000;
const PENDING_BATCH_SIZE = 250;
const DEFAULT_INITIAL_CATCHUP_DAYS = 30;

function validDate(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
}

class ImapService {
    constructor(host, port, user, password, onNewEmail, options = {}) {
        this.host = host;
        this.port = port;
        this.user = user;
        this.password = password;
        this.onNewEmail = onNewEmail;
        this.database = options.database || null;
        this.userId = options.userId || null;
        this.mailboxName = options.mailboxName || 'INBOX';
        this.mailboxKey = `${String(user || '').trim().toLowerCase()}:${this.mailboxName}`;
        this.initialSyncSince = validDate(options.initialSyncSince) ||
            new Date(Date.now() - DEFAULT_INITIAL_CATCHUP_DAYS * 24 * 60 * 60 * 1000);
        this.reconnectTimeout = null;
        this.reconnectDelay = 5000;
        this.lock = null;
        this.retryUnseenInterval = null;
        this.processingUnseen = null;
        this.client = this._createClient();

        const cleanup = async () => {
            console.log('\nShutting down IMAP client gracefully...');
            if (this.retryUnseenInterval) clearInterval(this.retryUnseenInterval);
            if (this.lock) { try { this.lock.release(); } catch (error) {} }
            if (this.client.usable) { try { await this.client.logout(); } catch (error) {} }
            process.exit(0);
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
    }

    getDatabase() {
        return this.database || getDbService();
    }

    _createClient() {
        return new ImapFlow({
            host: this.host,
            port: this.port,
            secure: true,
            auth: { user: this.user, pass: this.password },
            logger: false,
        });
    }

    async start() {
        try {
            console.log('Connecting to IMAP server...');
            await this.client.connect();
            this.reconnectDelay = 5000;
            console.log('Connected to email!');

            this.lock = await this.client.getMailboxLock(this.mailboxName);
            try {
                await this.backfillMissingSources();
                await this.processUnseen();
                this.startRetryPolling();

                console.log(`Listening for new emails in ${this.mailboxName}...`);
                this.client.on('exists', async () => {
                    console.log('New email arrived! Synchronizing mailbox...');
                    await this.processUnseen();
                });
                this.client.on('error', (error) => {
                    console.error('IMAP Error:', error);
                    this.handleReconnect();
                });
                this.client.on('close', () => {
                    console.log('IMAP Connection Closed');
                    this.handleReconnect();
                });
            } catch (error) {
                console.error('Error setting up inbox:', error);
                if (this.lock) { try { this.lock.release(); } catch (releaseError) {} }
                this.lock = null;
                this.handleReconnect();
            }
        } catch (error) {
            console.error('Failed to connect to IMAP server:', error);
            this.handleReconnect();
        }
    }

    getUidValidity() {
        const uidValidity = this.client.mailbox?.uidValidity;
        if (uidValidity === null || uidValidity === undefined) {
            throw new Error('IMAP mailbox did not provide UIDVALIDITY');
        }
        return String(uidValidity);
    }

    async discoverMessages() {
        const database = this.getDatabase();
        const uidValidity = this.getUidValidity();
        const state = await database.prepareEmailSync(this.mailboxKey, uidValidity);
        const searchQuery = state.lastDiscoveredUid > 0
            ? { uid: `${state.lastDiscoveredUid + 1}:*` }
            : { since: this.initialSyncSince };
        const searchResult = await this.client.search(searchQuery, { uid: true });
        const newUids = (Array.isArray(searchResult) ? searchResult : [])
            .map(Number)
            .filter((uid) => Number.isSafeInteger(uid) && uid > state.lastDiscoveredUid);
        if (newUids.length) {
            await database.enqueueDiscoveredEmails(this.mailboxKey, uidValidity, newUids, {
                adoptLegacyProcessed: state.adoptLegacyProcessed,
            });
            console.log(`Discovered ${newUids.length} email(s) for durable synchronization.`);
        }
        return uidValidity;
    }

    async processOne(uid, uidValidity, options = {}) {
        const database = this.getDatabase();
        const { force = false, onNewEmailOptions = {} } = options;
        try {
            if (!force && await database.isEmailProcessed(uid, this.mailboxKey, uidValidity)) return;

            const message = await this.client.fetchOne(
                uid,
                { source: true, uid: true, envelope: true },
                { uid: true }
            );
            if (!message?.source) {
                await database.markEmailFailed(uid, this.mailboxKey, uidValidity, 'Message is no longer available in the mailbox');
                return;
            }

            const parsedMail = await simpleParser(message.source);
            let headers = '';
            if (parsedMail.from?.text) headers += `From: ${parsedMail.from.text}\n`;
            if (parsedMail.to?.text) headers += `To: ${parsedMail.to.text}\n`;
            if (parsedMail.subject) headers += `Subject: ${parsedMail.subject}\n`;
            if (headers) headers += '\n';
            const emailBody = headers + (parsedMail.text || parsedMail.html || '');
            const receivedAt = parsedMail.date ? parsedMail.date.toISOString() : new Date().toISOString();
            const sourceEmailKey = `${this.mailboxKey}:${uidValidity}:${uid}`;
            const success = await this.onNewEmail(emailBody, `Email UID ${uid}`, receivedAt, {
                ...onNewEmailOptions,
                sourceEmailKey,
                rawEmailSource: Buffer.isBuffer(message.source)
                    ? message.source.toString('utf8')
                    : String(message.source || ''),
            });

            if (success) {
                await database.markEmailProcessed(uid, this.mailboxKey, uidValidity);
                await this.client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
            } else {
                await database.markEmailFailed(uid, this.mailboxKey, uidValidity, 'Transaction analysis did not complete');
                console.warn(`Email ${uid} remains in the durable retry queue.`);
            }
        } catch (error) {
            await database.markEmailFailed(uid, this.mailboxKey, uidValidity, error).catch(() => {});
            console.error(`Error processing email ${uid}:`, error);
        }
    }

    async backfillMissingSources() {
        const database = this.getDatabase();
        if (!this.userId || typeof database.getEmailSourceKeysNeedingReplay !== 'function') return 0;
        const uidValidity = this.getUidValidity();
        const prefix = `${this.mailboxKey}:${uidValidity}:`;
        const sourceKeys = await database.getEmailSourceKeysNeedingReplay(
            this.userId, this.mailboxKey, PENDING_BATCH_SIZE
        );
        const uids = sourceKeys
            .filter((sourceKey) => String(sourceKey).startsWith(prefix))
            .map((sourceKey) => Number(String(sourceKey).slice(prefix.length)))
            .filter((uid) => Number.isSafeInteger(uid) && uid > 0);
        if (!uids.length) return 0;

        console.log(`Backfilling captured source details for ${uids.length} processed email(s).`);
        for (let index = 0; index < uids.length; index += CONCURRENCY) {
            const batch = uids.slice(index, index + CONCURRENCY);
            await Promise.all(batch.map((uid) => this.processOne(uid, uidValidity, {
                force: true,
                onNewEmailOptions: {
                    allowBeforeSnapshot: true,
                    suppressNotifications: true,
                },
            })));
        }
        return uids.length;
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
            const uidValidity = await this.discoverMessages();
            const pending = await this.getDatabase().getPendingEmails(
                this.mailboxKey,
                uidValidity,
                PENDING_BATCH_SIZE
            );
            if (!pending.length) return;

            console.log(`Processing ${pending.length} queued email(s), including messages already marked read.`);
            for (let index = 0; index < pending.length; index += CONCURRENCY) {
                const batch = pending.slice(index, index + CONCURRENCY);
                await Promise.all(batch.map(({ uid }) => this.processOne(uid, uidValidity)));
            }
        } catch (error) {
            console.error('Error synchronizing mailbox:', error);
        }
    }

    startRetryPolling() {
        if (this.retryUnseenInterval) clearInterval(this.retryUnseenInterval);
        this.retryUnseenInterval = setInterval(() => {
            this.processUnseen().catch((error) => {
                console.error('Error retrying queued messages:', error);
            });
        }, RETRY_INTERVAL_MS);
        this.retryUnseenInterval.unref?.();
    }

    handleReconnect() {
        if (this.reconnectTimeout) return;
        if (this.retryUnseenInterval) {
            clearInterval(this.retryUnseenInterval);
            this.retryUnseenInterval = null;
        }
        console.log(`Attempting to reconnect in ${this.reconnectDelay / 1000}s...`);
        this.reconnectTimeout = setTimeout(async () => {
            this.reconnectTimeout = null;
            this.lock = null;
            this.client = this._createClient();
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5 * 60 * 1000);
            await this.start();
        }, this.reconnectDelay);
    }
}

module.exports = { ImapService };
