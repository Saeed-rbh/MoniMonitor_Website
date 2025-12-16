const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(bodyParser.json());

// Helper to read DB
const readDB = () => {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading DB:', err);
        return [];
    }
};

// Helper to write DB
const writeDB = (data) => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing DB:', err);
        return false;
    }
};

// Main endpoint
app.post('/MoniMonitor_ToDB', (req, res) => {
    const { status, user_id, record_entry, record_type } = req.body;

    if (status === 'read') {
        const data = readDB();
        // Filter by user_id if needed, but for now return all as mock
        // In a real app, you'd filter: const userTransactions = data.filter(t => t.userId === user_id);
        res.json(data);
    } else if (status === 'record') {
        const currentData = readDB();

        // Construct new record matching the structure
        // Original code sends: { status: "record", record_entry: rest, user_id: ..., record_type: Type }
        // We need to save it in a format compatible with "groupTransactionsByMonth"
        // The frontend expects an array of objects with Amount, Category, Label, Reason, Timestamp, Type, etc.

        const newTransaction = {
            ...record_entry,
            Type: record_type,
            // Ensure Timestamp is present, frontend usually sends it in record_entry
        };

        currentData.push(newTransaction);
        writeDB(currentData);
        res.json({ message: "Success", data: newTransaction });
    } else {
        res.status(400).json({ error: "Invalid status" });
    }
});

// OpenAI Mock Endpoint (optional, to avoid errors if that's also called)
app.post('/MoniMonitor_Openai', (req, res) => {
    res.json("groceries"); // Mock label
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
