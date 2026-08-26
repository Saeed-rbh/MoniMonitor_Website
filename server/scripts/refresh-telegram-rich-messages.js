require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });

const dbService = require('../src/database/dbService');
const { editTelegramTransactionMessage } = require('../src/services/telegramService');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function refreshTelegramRichMessages() {
    const db = await dbService.getDb();
    const rows = await db.all(
        `SELECT * FROM transactions
         WHERE userId = ? AND TelegramMessageId IS NOT NULL AND TelegramMessageId != ''
         ORDER BY Timestamp ASC, id ASC`,
        [process.env.USER_ID]
    );

    let updated = 0;
    const failed = [];
    for (const transaction of rows) {
        const result = await editTelegramTransactionMessage(
            transaction.TelegramMessageId,
            transaction,
            'new'
        );
        if (result?.ok) updated += 1;
        else failed.push({ id: transaction.id, messageId: transaction.TelegramMessageId });

        // Keep well below Telegram's per-chat edit rate limit.
        await delay(80);
    }

    console.log(`[Telegram] Refreshed ${updated}/${rows.length} rich transaction messages.`);
    if (failed.length) {
        console.error('[Telegram] Messages not refreshed:', failed);
        process.exitCode = 1;
    }
}

refreshTelegramRichMessages().catch((error) => {
    console.error('[Telegram] Refresh failed:', error);
    process.exitCode = 1;
});
