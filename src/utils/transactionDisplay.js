import names from '../../shared/transactionNames.cjs';

export const getTransactionDisplayReason = (reason, label, transaction = {}) =>
  names.displayReason({ ...transaction, Reason: reason, Label: label });

export const isETransferTransaction = names.isETransfer;
