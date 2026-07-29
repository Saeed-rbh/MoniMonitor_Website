const { getDb } = require('./src/database/db');

async function viewDatabase() {
    try {
        const db = await getDb();
        
        console.log("==========================================");
        console.log("            USERS TABLE                   ");
        console.log("==========================================");
        const users = await db.all('SELECT * FROM users');
        console.table(users);

        console.log("\n==========================================");
        console.log("            ACCOUNTS TABLE                ");
        console.log("==========================================");
        const accounts = await db.all('SELECT * FROM accounts');
        console.table(accounts);

        console.log("\n==========================================");
        console.log("          TRANSACTIONS TABLE              ");
        console.log("==========================================");
        const transactions = await db.all('SELECT * FROM transactions');
        console.table(transactions);
        
    } catch (err) {
        console.error("Error viewing database:", err);
    }
}

viewDatabase();
