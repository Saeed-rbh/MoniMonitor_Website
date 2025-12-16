import { useEffect, useState } from "react";
import {
  fetchTransactions,
  fetchAllTransactionData,
  getSelectedMonthData,
} from "./transactionService";

export const fetchUserAttributes = async () => {
  try {
    const response = await fetch("/api/user/attributes"); // Adjust the endpoint as needed
    if (!response.ok) {
      throw new Error("Failed to fetch user attributes");
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching user attributes:", error);
    throw error; // Re-throw the error to handle it in the calling function
  }
};

// Custom hook for fetching transaction data based on the month and userId
export const useTransactionData = (whichMonth, userId) => {
  const [fullData, setFullData] = useState(null);
  const [displayData, setDisplayData] = useState({
    selected: {},
    Availability: [],
    netAmounts: {},
    transactions: [],
  });

  // 1. Fetch ALL data only when userId changes (or on mount)
  useEffect(() => {
    const loadAllData = async () => {
      const data = await fetchAllTransactionData(userId);
      setFullData(data);
    };
    loadAllData();
  }, [userId]);

  // 2. When whichMonth or fullData changes, just slice the data (instant)
  useEffect(() => {
    if (fullData) {
      const { transactions, selected } = getSelectedMonthData(
        fullData.totalTransactions,
        whichMonth
      );
      setDisplayData({
        selected: selected,
        Availability: fullData.Availability,
        netAmounts: fullData.netAmounts,
        transactions: transactions,
      });
    }
  }, [whichMonth, fullData]);

  return displayData;
};

// Custom hook for managing the selected month on the main page
export const useMainPageMonth = () => {
  const [mainPageMonth, setMainPageMonth] = useState(0);
  return { mainPageMonth, setMainPageMonth };
};

// Custom hook for initializing the Telegram WebApp
export const useTelegramWebApp = (setUserData) => {
  useEffect(() => {
    const initTelegramWebApp = () => {
      if (window.Telegram && window.Telegram.WebApp) {
        const telegram = window.Telegram.WebApp;
        const user = telegram.initDataUnsafe.user;
        const queryId = telegram.initDataUnsafe.query_id;
        if (queryId) {
          setUserData({
            userId: user.id,
            userName: user.first_name,
            userUsername: user.username,
            userLanguage: user.language_code,
            queryId,
          });
        }
      }
    };
    initTelegramWebApp();
  }, [setUserData]);
};
