require('dotenv').config({ quiet: true });
const { getDb } = require('../src/database/db');
const { e } = require('../src/services/telegramService');

async function repair({ apply = false } = {}) {
    const db = await getDb();
    const rows = await db.all("SELECT * FROM telegram_outbox WHERE action='sendMessage' AND status IN ('dead','retry','pending')");
    const candidates = rows.filter(row => {
        const payload = JSON.parse(row.payloadJson);
        return /^MoniMonitor (financial|operations) check:/.test(payload.text || '') && !payload.reliabilityFormatVersion;
    });
    if (apply) await db.withTransaction(async () => {
        for (const row of candidates) {
            const payload = JSON.parse(row.payloadJson);
            payload.text = e(payload.text); payload.reliabilityFormatVersion = 1;
            await db.run("UPDATE telegram_outbox SET payloadJson=?,status='pending',attempts=0,lastError=NULL,nextAttemptAt=?,leaseOwner=NULL,leaseExpiresAt=NULL WHERE id=? AND status IN ('dead','retry','pending') AND payloadJson=?", [JSON.stringify(payload), new Date().toISOString(), row.id, row.payloadJson]);
        }
        if (candidates.length) await db.run("INSERT INTO agent_audit_log(userId,action,status,details,createdAt) VALUES (?,'reliability_notification_format_repair','success',?,?)", [process.env.BACKUP_OWNER_USER_ID, JSON.stringify({ jobIds: candidates.map(row => row.id) }), new Date().toISOString()]);
    });
    return { apply, jobIds: candidates.map(row => row.id) };
}
if (require.main === module) repair({ apply: process.argv.includes('--apply') }).then(async result => { console.log(JSON.stringify(result)); await (await getDb()).close(); }).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { repair };
