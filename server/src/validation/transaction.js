const { z } = require("zod");
const { parseTimestamp } = require('../../../shared/calendar.cjs');

const normalizeCategory = (category) => ({
    "Save&Invest": "Saving",
    SavingWithdrawal: "Investment",
    Transfer: "Internal",
}[category] || category);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const transactionFields = {
    Amount: z.coerce.number().finite().positive().max(1_000_000_000),
    Category: z.preprocess(normalizeCategory, z.enum([
        "Expense", "Income", "Internal", "Investment", "Saving",
    ])),
    Label: optionalText(100),
    Reason: optionalText(500),
    Timestamp: z.string().trim().max(64).refine((value) => parseTimestamp(value) !== null, 'Use a valid calendar date or transaction timestamp'),
    Type: optionalText(100),
    Account: optionalText(100),
    BankName: optionalText(100),
    ReferenceNumber: optionalText(200),
};

const transactionSchema = z.object(transactionFields).strict();
const transactionUpdateSchema = z.object({
    ...Object.fromEntries(Object.entries(transactionFields).map(([key, value]) => [key, value.optional()])),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one transaction field is required",
});

const parseTransaction = (input) => transactionSchema.parse({
    ...input,
    Timestamp: input.Timestamp === undefined ? new Date().toISOString() : input.Timestamp,
});

module.exports = { parseTransaction, transactionUpdateSchema };
