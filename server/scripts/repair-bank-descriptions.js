const fs=require('node:fs'),path=require('node:path');
const sqlite3=require('sqlite3'),{open}=require('sqlite');
const {protectConnection}=require('../src/database/transactionConnection');
const {repairBankDescriptions}=require('../src/services/bankDescriptionRepair');
(async()=>{
    const [filename,planPath,userId]=process.argv.slice(2).filter(a=>a!=='--apply');
    if(!filename||!planPath||!userId)throw Error('Usage: node repair-bank-descriptions.js DB PLAN USER [--apply]');
    const plan=JSON.parse(fs.readFileSync(planPath,'utf8'));
    if(plan.userId!==userId || !Array.isArray(plan.entries))throw Error('Invalid reviewed plan owner');
    const db=await open({filename,driver:sqlite3.Database});db.configure('busyTimeout',10000);protectConnection(db);
    try{
        if(process.argv.includes('--apply')){
            const backup=path.resolve(filename+'.before-descriptions-'+Date.now()+'.sqlite');
            await db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);
            console.log(JSON.stringify({backup}));
        }
        let result;
        try{await db.withTransaction(async()=>{
            result=await repairBankDescriptions(db,userId,plan.entries);
            if(!process.argv.includes('--apply'))throw Error('PREVIEW_ROLLBACK');
        });}catch(error){if(error.message!=='PREVIEW_ROLLBACK')throw error;}
        console.log(JSON.stringify({applied:process.argv.includes('--apply'),...result,integrity:await db.get('PRAGMA quick_check')}));
    }finally{await db.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1});
