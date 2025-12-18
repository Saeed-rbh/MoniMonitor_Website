const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3001;
const DB_FILE = path.join(__dirname, 'db.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = 'your_super_secret_key_change_in_production'; // Simple secret for local dev

app.use(cors());
app.use(bodyParser.json());

// --- Helpers ---

const readJSON = (file) => {
    try {
        if (!fs.existsSync(file)) {
            return [];
        }
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error reading ${file}:`, err);
        return [];
    }
};

const writeJSON = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error(`Error writing ${file}:`, err);
        return false;
    }
};

// --- Middleware ---

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- Auth Endpoints ---

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    const users = readJSON(USERS_FILE);
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: "User already exists" });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = { id: Date.now().toString(), username, password: hashedPassword };
        users.push(newUser);
        writeJSON(USERS_FILE, users);
        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error registering user" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(400).json({ error: "User not found" });
    }

    try {
        if (await bcrypt.compare(password, user.password)) {
            const accessToken = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
            res.json({ accessToken, user: { id: user.id, username: user.username } });
        } else {
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (error) {
        res.status(500).json({ error: "Error logging in" });
    }
});

// --- Data Endpoints ---

// Main endpoint - Protected
app.post('/MoniMonitor_ToDB', authenticateToken, (req, res) => {
    const { status, record_entry, record_type } = req.body;
    const userId = req.user.userId;

    if (status === 'read') {
        const allData = readJSON(DB_FILE);
        // Filter by authenticated user's ID
        const userData = allData.filter(t => t.userId === userId);
        res.json(userData);
    } else if (status === 'record') {
        const currentData = readJSON(DB_FILE);

        const newTransaction = {
            ...record_entry,
            Type: record_type,
            userId: userId, // Enforce server-side user ID assignment
            Timestamp: record_entry.Timestamp || new Date().toISOString()
        };

        currentData.push(newTransaction);
        writeJSON(DB_FILE, currentData);
        res.json({ message: "Success", data: newTransaction });
    } else {
        res.status(400).json({ error: "Invalid status" });
    }
});

// OpenAI Mock Endpoint (optional)
app.post('/MoniMonitor_Openai', (req, res) => {
    res.json("groceries"); // Mock label
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
