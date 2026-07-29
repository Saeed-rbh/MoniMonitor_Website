const { z } = require("zod");

const normalizeCategory = (category) => category === "Save&Invest" ? "Saving" : category;
const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const transactionFields = {
    Amount: z.coerce.number().finite().positive().max(1_000_000_000),
    Category: z.preprocess(normalizeCategory, z.enum(["Income", "Expense", "Saving"])),
    Label: optionalText(100),
    Reason: optionalText(500),
    Timestamp: z.string().trim().min(1).max(64),
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
    Timestamp: input.Timestamp || new Date().toISOString(),
});

module.exports = { parseTransaction, transactionUpdateSchema };
