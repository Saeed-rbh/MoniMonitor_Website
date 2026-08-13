require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { onNewEmail } = require('../email_agent');
const dbService = require('../src/database/dbService');

const requiredEnvironment = ['IMAP_USER', 'IMAP_PASSWORD', 'USER_ID'];
for (const name of requiredEnvironment) {
    if (!process.env[name]) throw new Error(`${name} is required`);
}

const baselineFileFlag = process.argv.indexOf('--baseline-file');
const afterFlag = process.argv.indexOf('--after');
const baselinePath = baselineFileFlag >= 0
    ? path.resolve(process.argv[baselineFileFlag + 1])
    : null;
const cutoff = afterFlag >= 0
        ? new Date(process.argv[afterFlag + 1])
        : null;
if (cutoff && Number.isNaN(cutoff.getTime())) throw new Error('The email cutoff is invalid');

async function analyzeQuietly(emailBody, idInfo, receivedAt, accountCutoffs) {
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
        return await onNewEmail(emailBody, idInfo, receivedAt, {
            allowBeforeSnapshot: true,
            suppressNotifications: true,
            accountCutoffs,
        });
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }
}

async function main() {
    let accountCutoffs = null;
    let searchCutoff = cutoff;
    if (baselinePath) {
        const baselineRows = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        if (!Array.isArray(baselineRows) || !baselineRows.length) {
            throw new Error('The baseline file must be a non-empty JSON transaction array');
        }

        const latestByAccount = new Map();
        for (const row of baselineRows) {
            const account = String(row.Account || '').trim();
            const timestamp = new Date(row.Timestamp);
            if (!account || Number.isNaN(timestamp.getTime())) continue;
            const current = latestByAccount.get(account);
            if (!current || timestamp > current) latestByAccount.set(account, timestamp);
        }

        const accounts = await dbService.getInvestmentAccounts(process.env.USER_ID);
        const byId = {};
        const byAlias = {};
        for (const account of accounts) {
            const accountCutoff = latestByAccount.get(account.name);
            if (!accountCutoff) continue;
            byId[String(account.id)] = accountCutoff.toISOString();
            for (const alias of [account.name, account.accountRef]) {
                const normalized = String(alias || '').trim().toLowerCase();
                if (normalized) byAlias[normalized] = accountCutoff.toISOString();
            }
        }
        for (const [account, accountCutoff] of latestByAccount) {
            byAlias[account.trim().toLowerCase()] = accountCutoff.toISOString();
        }
        accountCutoffs = { byId, byAlias };
        searchCutoff = new Date(Math.min(...[...latestByAccount.values()].map((value) => value.getTime())));

        console.log('Imported account cutoffs:');
        console.log(JSON.stringify(Object.fromEntries(
            [...latestByAccount].map(([account, value]) => [account, value.toISOString()])
        ), null, 2));
    }

    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
        logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let analyzed = 0;
    let accepted = 0;
    let retryRequired = 0;
    let skippedAtOrBeforeCutoff = 0;
    let skippedWithoutDate = 0;

    try {
        const uids = await client.search(searchCutoff ? { since: searchCutoff } : { all: true }, { uid: true });
        console.log(
            searchCutoff
                ? `Checking ${uids.length} inbox candidate(s) received after ${searchCutoff.toISOString()}.`
                : `Reanalyzing ${uids.length} inbox message(s) against the imported ledger.`
        );

        for (const uid of uids) {
            const message = await client.fetchOne(
                uid,
                { source: true, uid: true, envelope: true },
                { uid: true }
            );
            if (!message?.source) continue;

            const parsedMail = await simpleParser(message.source);
            const messageDate = parsedMail.date || message.envelope?.date || null;
            if (!messageDate) {
                skippedWithoutDate += 1;
                continue;
            }
            if (!accountCutoffs && cutoff && messageDate.getTime() <= cutoff.getTime()) {
                skippedAtOrBeforeCutoff += 1;
                continue;
            }
            const emailBody = parsedMail.text || parsedMail.html || '';
            const receivedAt = messageDate.toISOString();
            const success = await analyzeQuietly(
                emailBody, `Replay UID ${uid}`, receivedAt, accountCutoffs
            );
            analyzed += 1;

            if (success) {
                accepted += 1;
                await dbService.markEmailProcessed(uid);
            } else {
                retryRequired += 1;
            }

            if (analyzed % 10 === 0 || analyzed === uids.length) {
                console.log(`Progress: ${analyzed}/${uids.length}`);
            }
        }

        console.log(JSON.stringify({
            searchCutoff: searchCutoff?.toISOString() || null,
            candidates: uids.length,
            analyzed,
            accepted,
            retryRequired,
            skippedAtOrBeforeCutoff,
            skippedWithoutDate,
        }, null, 2));
    } finally {
        lock.release();
        await client.logout();
        const db = await dbService.getDb();
        await db.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
