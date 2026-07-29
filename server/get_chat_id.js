require('dotenv').config();
const { sendTelegramMessage, deleteTelegramMessage, formatTransactionMessage } = require('./src/services/telegramService');

async function demo() {
    // Step 1: Simulate generic bank alert arriving first
    console.log('Step 1: Sending generic "Bank Withdrawal" alert...');
    const genericTx = {
        id: 999,
        Category: 'Expense',
        Amount: '8.74',
        Label: 'Withdrawal',
        Reason: 'Bank Withdrawal',
        Type: 'Credit Card',
        Account: '************2379',
        BankName: 'RBC Royal Bank',
        ReferenceNumber: null,
        Timestamp: new Date().toISOString()
    };

    const r1 = await sendTelegramMessage(formatTransactionMessage(genericTx));
    const msgId = r1?.result?.message_id;
    console.log(`Generic message sent. message_id: ${msgId}`);

    // Wait 4 seconds so you can see the generic message appear
    console.log('Waiting 4 seconds before upgrade...');
    await new Promise(r => setTimeout(r, 4000));

    // Step 2: Specific email arrives — delete old, send fresh
    console.log('Step 2: Deleting generic message and sending specific...');
    if (msgId) await deleteTelegramMessage(msgId);

    const specificTx = {
        ...genericTx,
        Label: 'Coffee & Cafes',
        Reason: 'PAPA CAFE & PASTRY',
        ReferenceNumber: 'C1AYcaHmg5ZY'
    };

    const r2 = await sendTelegramMessage(formatTransactionMessage(specificTx));
    console.log(`Specific message sent. message_id: ${r2?.result?.message_id}`);
    console.log('\nDemo complete!');
    process.exit(0);
}

demo();
