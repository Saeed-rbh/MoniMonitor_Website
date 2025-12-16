const fs = require('fs');
const path = require('path');

const filePath = 'c:\\Users\\Saeed\\Personal_Files\\CodeDevelope\\MoniMonitor_Website\\src\\services\\mockTransactions.json';
const rawData = fs.readFileSync(filePath);
const transactions = JSON.parse(rawData);

const monthlyKeywords = ['Rogers', 'Bell', 'Netflix', 'Spotify', 'Rent', 'Mortgage', 'Insurance', 'GoodLife', 'WealthSimple Auto-Invest'];
const dailyKeywords = ['Starbucks', 'Tim Hortons', 'Subway', 'McDonalds', 'Uber ', 'Lyft']; // Space after Uber to avoid matches like UberEats if handled differently

const updatedTransactions = transactions.map(t => {
    let frequency = 'OneTime';

    // Check for Monthly
    if (monthlyKeywords.some(k => t.Reason.includes(k))) {
        frequency = 'Monthly';
    }
    // Check for Daily (overrides monthly if collision, though unlikely with this list)
    else if (dailyKeywords.some(k => t.Reason.includes(k))) {
        frequency = 'Daily';
    }

    // Specific logic: WealthSimple is usually "Save&Invest" which implies monthly auto-invest often
    if (t.Category === 'Save&Invest' && t.Reason.includes('WealthSimple')) {
        frequency = 'Monthly';
    }

    return { ...t, Frequency: frequency };
});

fs.writeFileSync(filePath, JSON.stringify(updatedTransactions, null, 2));
console.log('Updated ' + updatedTransactions.length + ' transactions.');
