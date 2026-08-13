export const getTransactionDisplayReason = (reason, label) => {
  const cleanReason = String(reason || "").trim();
  const cleanLabel = String(label || "").trim();

  if (!cleanReason) return "No reason provided";
  if (!cleanLabel) return cleanReason;

  const separators = [" - ", " – ", " — ", ": "];
  const lowerReason = cleanReason.toLocaleLowerCase();
  const lowerLabel = cleanLabel.toLocaleLowerCase();

  for (const separator of separators) {
    const prefix = `${lowerLabel}${separator}`;
    if (lowerReason.startsWith(prefix)) {
      const remainder = cleanReason.slice(cleanLabel.length + separator.length).trim();
      return remainder || cleanReason;
    }
  }

  return cleanReason;
};
