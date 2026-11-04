import { useState } from "react";
import { fetchAllTransactionData, getSelectedMonthData } from "../services/transactionService";

import { useRemoteData } from './useRemoteData';

export const useTransactionData = (whichMonth, userId, requestedCurrency) => {
  const remote = useRemoteData(fetchAllTransactionData, userId);
  const currency = requestedCurrency || remote.data?.currency || 'USD';
  const fullData = remote.data?.byCurrency ? remote.data.byCurrency[currency] : remote.data;
  const { transactions, selected } = getSelectedMonthData(fullData?.totalTransactions || {}, whichMonth);
  return {
    ...remote, selected, transactions, currency, currencies: remote.data?.currencies || [],
    Availability: fullData?.Availability || [],
    netAmounts: fullData?.netAmounts || {},
    allTransactions: fullData?.totalTransactions || {},
  };
};

export const useMainPageMonth = () => {
  const [mainPageMonth, setMainPageMonth] = useState(0);
  return { mainPageMonth, setMainPageMonth };
};
