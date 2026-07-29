import { useEffect, useState } from "react";
import { fetchAllTransactionData, getSelectedMonthData } from "../services/transactionService";

const emptyDisplayData = {
  selected: {},
  Availability: [],
  netAmounts: {},
  transactions: [],
  allTransactions: {},
  isLoading: true,
  error: null,
};

export const useTransactionData = (whichMonth, userId) => {
  const [fullData, setFullData] = useState(null);
  const [displayData, setDisplayData] = useState(emptyDisplayData);

  useEffect(() => {
    let active = true;
    const loadAllData = async () => {
      setDisplayData((current) => ({ ...current, isLoading: true, error: null }));
      try {
        const data = await fetchAllTransactionData();
        if (active) setFullData(data);
      } catch (error) {
        if (active) {
          setFullData(null);
          setDisplayData({ ...emptyDisplayData, isLoading: false, error });
        }
      }
    };

    if (userId) loadAllData();
    else {
      setFullData({ totalTransactions: {}, Availability: [], netAmounts: {} });
      setDisplayData({ ...emptyDisplayData, isLoading: false });
    }

    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!fullData) return;
    const { transactions, selected } = getSelectedMonthData(fullData.totalTransactions, whichMonth);
    setDisplayData({
      selected,
      Availability: fullData.Availability,
      netAmounts: fullData.netAmounts,
      transactions,
      allTransactions: fullData.totalTransactions || {},
      isLoading: false,
      error: null,
    });
  }, [whichMonth, fullData]);

  return displayData;
};

export const useMainPageMonth = () => {
  const [mainPageMonth, setMainPageMonth] = useState(0);
  return { mainPageMonth, setMainPageMonth };
};
