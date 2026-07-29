const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const dbService = require('../database/dbService');

// Fix #6: Process emails in batches of this size concurrently
const CONCURRENCY = 3;

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
        this.client = this._createClient();

        // Graceful shutdown: release lock and logout on Ctrl+C or system kill
        const cleanup = async () => {
            console.log('\nShutting down IMAP client gracefully...');
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

            this.lock = await this.client.getMailboxLock('INBOX');
            try {
                // Process existing unseen emails on startup
                await this.processUnseen();

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
                console.error("Error setting up inbox:", err);
                if (this.lock) { try { this.lock.release(); } catch(e) {} }
            }
        } catch (err) {
            console.error("Failed to connect to IMAP server:", err);
            this.handleReconnect();
        }
    }

    async processOne(seq) {
        const message = await this.client.fetchOne(seq, { source: true, uid: true, envelope: true });
        if (!message || !message.source) return;

        // Skip if already successfully processed in a previous run
        if (await dbService.isEmailProcessed(message.uid)) {
            await this.client.messageFlagsAdd(seq, ['\\Seen']);
            return;
        }

        try {
            const parsedMail = await simpleParser(message.source);
            const emailBody = parsedMail.text || parsedMail.html || "";
            // Fix #5: capture when the email was received (from email Date header)
            const receivedAt = parsedMail.date ? parsedMail.date.toISOString() : new Date().toISOString();
            
            const success = await this.onNewEmail(emailBody, `Unread UID ${message.uid}`, receivedAt);
            
            if (success) {
                await dbService.markEmailProcessed(message.uid);
                await this.client.messageFlagsAdd(seq, ['\\Seen']);
            }
        } catch (err) {
            console.error(`Error processing email ${message.uid}:`, err);
        }
    }

    async processUnseen() {
        try {
            let messages = await this.client.search({ unseen: true });
            if (messages.length === 0) return;

            console.log(`Found ${messages.length} unread email(s).`);

            // Fix #6: Process in batches of CONCURRENCY to speed up startup
            for (let i = 0; i < messages.length; i += CONCURRENCY) {
                const batch = messages.slice(i, i + CONCURRENCY);
                await Promise.all(batch.map(seq => this.processOne(seq)));
            }
        } catch (err) {
            console.error("Error processing unseen messages:", err);
        }
    }

    handleReconnect() {
        if (this.reconnectTimeout) return;
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
