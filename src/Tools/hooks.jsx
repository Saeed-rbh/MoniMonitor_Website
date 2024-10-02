import { useEffect, useState } from "react";
import { fetchTransactions } from "./transactionService";

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
  const [data, setData] = useState({
    selected: [],
    Availability: [],
    netAmounts: [],
    transactions: [],
  });

  useEffect(() => {
    const fetchData = async () => {
      const result = await fetchTransactions({ whichMonth, userId });
      setData({
        selected: result.selected,
        Availability: result.Availability,
        netAmounts: result.netAmounts,
        transactions: result.transactions,
      });
    };
    fetchData();
  }, [whichMonth, userId]);

  return data;
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
