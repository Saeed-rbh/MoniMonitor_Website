const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const getRandomFloat = (min, max) => (Math.random() * (max - min) + min).toFixed(2);

const categories = {
    Income: ['Salary', 'Freelance', 'Dividend', 'Refund'],
    Expense: ['Food', 'Transport', 'Utilities', 'Entertainment', 'Shopping', 'Health', 'Rent'],
    'Save&Invest': ['Savings', 'Crypto', 'Stocks', 'Emergency Fund']
};

const generateData = () => {
    const data = [];
    const currentDate = new Date('2025-12-15'); // Current assumed date

    // Generate for 15 months back
    for (let i = 0; i < 15; i++) {
        const monthDate = new Date(currentDate);
        monthDate.setMonth(currentDate.getMonth() - i);
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // 1. Monthly Salary (Income)
        data.push({
            Amount: getRandomFloat(3000, 3500),
            Category: 'Income',
            Label: 'Salary',
            Reason: 'Monthly Salary',
            Timestamp: new Date(year, month, 1, 9, 0, 0).toISOString(),
            Type: 'Credit'
        });

        // 2. Rent (Expense)
        data.push({
            Amount: getRandomFloat(1000, 1100),
            Category: 'Expense',
            Label: 'Rent',
            Reason: 'Apartment Rent',
            Timestamp: new Date(year, month, 2, 10, 0, 0).toISOString(),
            Type: 'Debit'
        });

        // 3. Savings (Save&Invest)
        data.push({
            Amount: getRandomFloat(200, 500),
            Category: 'Save&Invest',
            Label: 'Savings',
            Reason: 'Monthly Savings',
            Timestamp: new Date(year, month, 5, 12, 0, 0).toISOString(),
            Type: 'Transfer'
        });

        // 4. Random Expenses (Food, Transport, etc.) - 10 to 20 per month
        const numExpenses = getRandomInt(10, 20);
        for (let j = 0; j < numExpenses; j++) {
            const day = getRandomInt(1, daysInMonth);
            const category = 'Expense';
            const label = categories[category][getRandomInt(0, categories[category].length - 1)];
            let amount;

            switch (label) {
                case 'Food': amount = getRandomFloat(10, 100); break;
                case 'Transport': amount = getRandomFloat(5, 50); break;
                case 'Utilities': amount = getRandomFloat(50, 150); break;
                case 'Shopping': amount = getRandomFloat(20, 200); break;
                default: amount = getRandomFloat(10, 80);
            }

            data.push({
                Amount: amount,
                Category: category,
                Label: label,
                Reason: `${label} purchase`,
                Timestamp: new Date(year, month, day, getRandomInt(8, 22), getRandomInt(0, 59), 0).toISOString(),
                Type: 'Debit'
            });
        }

        // 5. Random Extra Income (Freelance/Refund) - 30% chance
        if (Math.random() > 0.7) {
            const day = getRandomInt(1, daysInMonth);
            data.push({
                Amount: getRandomFloat(100, 500),
                Category: 'Income',
                Label: 'Freelance',
                Reason: 'Side Project',
                Timestamp: new Date(year, month, day, 14, 0, 0).toISOString(),
                Type: 'Credit'
            });
        }
    }

    // Sort by Timestamp
    data.sort((a, b) => new Date(a.Timestamp) - new Date(b.Timestamp));

    return data;
};

const mockData = generateData();

fs.writeFile(DB_FILE, JSON.stringify(mockData, null, 2), (err) => {
    if (err) {
        console.error('Error writing to file', err);
    } else {
        console.log('Successfully generated 15 months of mock data!');
    }
});
