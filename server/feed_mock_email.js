require('dotenv').config();

const dbService = require('./src/database/dbService');
const { onNewEmail } = require('./email_agent');

const USER_ID = process.env.BACKUP_OWNER_USER_ID || process.env.USER_ID;

async function main() {
    if (!USER_ID || !process.env.AI_API_KEY || !process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
        throw new Error('USER_ID, AI_API_KEY, TELEGRAM_BOT_TOKEN, and TELEGRAM_CHAT_ID must be configured');
    }

    const settings = await dbService.getUserSettings(USER_ID);
    const currency = settings?.currency || 'CAD';
    let accounts = await dbService.getInvestmentAccounts(USER_ID);
    let account = accounts.find((item) => item.name === 'Email Test · Wealthsimple TFSA');

    if (!account) {
        account = await dbService.createInvestmentAccount(USER_ID, {
            name: 'Email Test · Wealthsimple TFSA',
            institution: 'Wealthsimple',
            accountType: 'TFSA',
            currency,
            cashMinor: 75000,
        });
        console.log(`Created test portfolio account ${account.id} with ${currency} 750.00 cash.`);
    }

    const reference = `MM-EMAIL-${Date.now().toString(36).toUpperCase()}`;
    const amount = '247.31';
    const receivedAt = new Date().toISOString();
    const email = `
From: Wealthsimple Notifications <notifications@wealthsimple.example>
Subject: Your TFSA contribution is complete

This is a financial account transaction notification.

Your contribution of ${currency} $${amount} has been successfully deposited as new cash into
your portfolio account named "${account.name}" at Wealthsimple.

Account type: TFSA
Activity: Contribution / cash deposit
This is not a stock purchase and is not a transfer between two accounts you own.
Reference number: ${reference}
Transaction date: ${receivedAt}

Thank you,
Wealthsimple Notifications
`;

    console.log(`Feeding mock financial email ${reference} through the real AI ingestion path...`);
    const processed = await onNewEmail(email, reference, receivedAt);
    if (!processed) throw new Error('The email could not be processed');

    const summary = await dbService.getPortfolioSummary(USER_ID);
    const activity = summary.emailActivities.find((item) => item.referenceNumber === reference);
    const updatedAccount = summary.accounts.find((item) => item.id === account.id);

    console.log(JSON.stringify({
        processed,
        reference,
        aiIdentified: activity ? { label: activity.label, reason: activity.reason } : null,
        portfolioApplied: activity?.kind || null,
        portfolioAccount: activity?.accountName || null,
        accountCashMinor: updatedAccount?.cashMinor,
        telegramNotification: 'sent by the normal notifyAndSave flow',
    }, null, 2));

    if (!activity) throw new Error('Transaction was processed but no website email activity was found');
}

main().catch((error) => {
    console.error('Mock email feed failed:', error.message);
    process.exitCode = 1;
});
