import { useEffect, useState, useCallback } from "react";
import { fetchAllTransactionData, getSelectedMonthData } from "../services/transactionService";

const emptyDisplayData = {
  selected: {},
  Availability: [],
  netAmounts: {},
  transactions: [],
  allTransactions: {},
  isLoading: true,
  isOffline: typeof navigator !== "undefined" ? !navigator.onLine : false,
  error: null,
  refetch: () => {},
};

export const useTransactionData = (whichMonth, userId) => {
  const [fullData, setFullData] = useState(null);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [displayData, setDisplayData] = useState(emptyDisplayData);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
    };
  }, []);

  const loadAllData = useCallback(async (retryCount = 0) => {
    setDisplayData((current) => ({
      ...current,
      isLoading: !fullData,
      error: null,
    }));
    try {
      const data = await fetchAllTransactionData();
      setFullData(data);
    } catch (error) {
      if (retryCount < 2) {
        setTimeout(() => loadAllData(retryCount + 1), 2000 * (retryCount + 1));
      } else {
        setDisplayData((prev) => ({ ...prev, isLoading: false, error }));
      }
    }
  }, [fullData]);

  useEffect(() => {
    if (userId) {
      loadAllData();
    } else {
      setFullData({ totalTransactions: {}, Availability: [], netAmounts: {} });
      setDisplayData({ ...emptyDisplayData, isLoading: false, isOffline });
    }
  }, [userId, loadAllData, isOffline]);

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
      isOffline,
      error: null,
      refetch: loadAllData,
    });
  }, [whichMonth, fullData, loadAllData, isOffline]);

  return displayData;
};

export const useMainPageMonth = () => {
  const [mainPageMonth, setMainPageMonth] = useState(0);
  return { mainPageMonth, setMainPageMonth };
};
