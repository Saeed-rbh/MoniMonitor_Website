const DATE_ONLY_UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z$/;

export const isDateOnlyTransactionTimestamp = (value) =>
  typeof value === "string" && DATE_ONLY_UTC_TIMESTAMP.test(value);

// Bank emails often state a calendar date without a time. The parser represents
// those values as midnight UTC, which moves them to the previous day in western
// time zones. Treat that exact representation as local midnight so the stated
// bank date remains stable in the UI.
export const parseTransactionDate = (value) => {
  const dateOnlyMatch = typeof value === "string"
    ? value.match(DATE_ONLY_UTC_TIMESTAMP)
    : null;

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(value);
};

