// Synthetic fixtures only. Evaluates validation and account matching, never sends private data to a model.
const { parseAIResponseText } = require('../src/services/aiService');
const { accountMatchScore } = require('../src/services/accountMatching');
const base = { Amount: '42.50', Category: 'Expense', Label: 'Shopping', Reason: 'Example Store',
    Account: '1234', BankName: 'Example Bank', BalanceAccountId: null, PortfolioAccountId: null,
    PortfolioQuantity: null, PortfolioPrice: null };
const parsing = [
    { name: 'purchase', value: base, valid: true },
    { name: 'internal-transfer', value: { ...base, Category: 'Internal', Label: 'Internal Transfer' }, valid: true },
    { name: 'null-like-numbers', value: { ...base, PortfolioQuantity: 'null', PortfolioPrice: 'NaN' }, valid: true },
    { name: 'non-bank-email', value: { error: 'Not a bank email' }, valid: true },
    { name: 'unknown-category', value: { ...base, Category: 'Instructions' }, valid: false },
    { name: 'category-label-conflict', value: { ...base, Category: 'Income' }, valid: false },
    { name: 'invalid-confidence', value: { ...base, BalanceAccountConfidence: 'CERTAIN' }, valid: false },
    { name: 'invalid-symbol', value: { ...base, PortfolioSymbol: '<script>' }, valid: false },
];
const accounts = [
    { id: 1, name: 'Chequing', accountRef: '00001234', institution: 'Example Bank', accountType: 'Chequing' },
    { id: 2, name: 'Savings', accountRef: '00005678', institution: 'Example Bank', accountType: 'Savings' },
];
const matching = [
    { reference: '****1234', expected: 1 }, { reference: '00005678', expected: 2 },
    { reference: null, expected: null }, { reference: '9999', expected: null },
];
const failures = [];
for (const fixture of parsing) {
    let valid = true;
    try { parseAIResponseText(JSON.stringify(fixture.value)); } catch { valid = false; }
    if (valid !== fixture.valid) failures.push(fixture.name);
}
for (const fixture of matching) {
    const ranked = accounts.map(account => ({ id: account.id, score: accountMatchScore({ Account: fixture.reference }, account) }))
        .sort((a, b) => b.score - a.score);
    const selected = ranked[0].score >= 95 && ranked[0].score > ranked[1].score ? ranked[0].id : null;
    if (selected !== fixture.expected) failures.push(`match-${fixture.reference}`);
}
console.log(JSON.stringify({ suite: 'synthetic-validation-and-matching-v1', modelCalls: 0,
    cases: parsing.length + matching.length, passed: parsing.length + matching.length - failures.length, failures,
    limitation: 'Measures deterministic validation and matching; does not measure live model extraction accuracy.' }, null, 2));
process.exitCode = failures.length ? 1 : 0;
