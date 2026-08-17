import { useEffect, useState, useCallback, useRef } from "react";
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
  const fullDataRef = useRef(fullData);
  fullDataRef.current = fullData;

  const prevIsOfflineRef = useRef(isOffline);
  const prevUserIdRef = useRef(null);

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
      isLoading: !fullDataRef.current,
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
  }, []);

  useEffect(() => {
    if (userId) {
      const cameBackOnline = prevIsOfflineRef.current && !isOffline;
      const userChanged = prevUserIdRef.current !== userId;
      prevUserIdRef.current = userId;

      if (userChanged || cameBackOnline || fullDataRef.current === null) {
        loadAllData();
      }
    } else {
      prevUserIdRef.current = null;
      setFullData(null);
      setDisplayData({ ...emptyDisplayData, isLoading: false, isOffline });
    }
    prevIsOfflineRef.current = isOffline;
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
