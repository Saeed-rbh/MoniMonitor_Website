const { ImapFlow } = require('imapflow');
require('dotenv').config();

const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASSWORD
    },
    logger: false
});

async function main() {
    await client.connect();
    let lock = await client.getMailboxLock('INBOX');
    try {
        console.log("Marking all messages as UNSEEN...");
        await client.messageFlagsRemove('1:*', ['\\Seen']);
        console.log("Done.");
    } finally {
        lock.release();
        await client.logout();
    }
}

main().catch(console.error);
