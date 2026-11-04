// Import only mappings supported by independent, reviewed bank/account evidence.
const fs = require('node:fs');
const { getDb, withDatabaseTransaction } = require('./src/database/db');
async function importAliases(file, userId) {
 const aliases = JSON.parse(fs.readFileSync(file,'utf8'));
 if (!Array.isArray(aliases) || !userId) throw new Error('Supply a JSON array and a user ID');
 await withDatabaseTransaction(async () => {
  const db=await getDb();
  for (const alias of aliases) {
   const account=await db.get('SELECT * FROM investment_accounts WHERE id = ? AND userId = ?',[alias.accountId,userId]);
   if (!account || !alias.label?.trim() || !alias.evidence?.trim() ||
       account.institution.toLowerCase()!==String(alias.institution).toLowerCase()) throw new Error('Invalid alias or account ownership/institution mismatch');
   await db.run(`INSERT INTO email_account_aliases (userId,institution,label,accountId,evidence) VALUES (?,?,?,?,?)
    ON CONFLICT(userId,institution,label) DO UPDATE SET accountId=excluded.accountId,evidence=excluded.evidence`,
    [userId,alias.institution,alias.label.trim(),account.id,alias.evidence]);
  }
 });
 return aliases.length;
}
if (require.main===module) {
 importAliases(process.argv[2],process.argv[3]).then(async n=>{console.log(`Imported ${n} reviewed email account mappings`);await(await getDb()).close();})
 .catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={importAliases};
