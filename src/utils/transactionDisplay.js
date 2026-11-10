import names from '@monimonitor/shared/transactionNames';

export const getTransactionDisplayReason = (reason, label, transaction = {}) =>
  names.displayReason({ ...transaction, Reason: reason, Label: label });

export const isETransferTransaction = names.isETransfer;
