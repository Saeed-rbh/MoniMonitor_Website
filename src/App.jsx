import "./App.css";
import React, { lazy, Suspense, useEffect, useState, useMemo } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import {
  useTransactionData,
  useMainPageMonth,
  useTelegramWebApp,
} from "./Tools/hooks";
import ErrorBoundary from "./ErrorBoundary";
import Transactions from "./Transactions/Transactions";
import AddTransaction from "./AddTransaction/AddTransaction";

// Lazy-loaded components
const MainMenu = lazy(() => import("./MainMenu/MainMenu"));
const Header = lazy(() => import("./Header/header"));
const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));
const Insight = lazy(() => import("./Insight/Insight"));
const Account = lazy(() => import("./Account/Account"));

const App = () => {
  // State management for user data
  const [userData, setUserData] = useState({
    userId: "",
    userName: "",
    userUsername: "",
    userLanguage: "",
    queryId: "",
  });

  // Session management
  const [whichMonth, setWhichMonth] = useState(0);
  const monthData = useTransactionData(whichMonth, userData.userId || 90260003);
  const [isMoreClicked, setIsMoreClicked] = useState(null);
  const [isAddClicked, setIsAddClicked] = useState(null);
  const [isDateClicked, setIsDateClicked] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Destructure the transaction data
  const {
    Availability: availabilityData,
    netAmounts: netAmountsData,
    transactions: transactionsData,
  } = useTransactionData(whichMonth, userData.userId);

  const { mainPageMonth, setMainPageMonth } = useMainPageMonth();
  const { selected: mainSelected } = useTransactionData(
    mainPageMonth,
    userData.userId
  );

  // Check if data is loaded
  useEffect(() => {
    if (
      Object.keys(mainSelected).length > 0 &&
      availabilityData.length > 0 &&
      !dataLoaded
    ) {
      setDataLoaded(true);
    }
  }, [mainSelected, availabilityData, dataLoaded]);

  // Memoize the Header component to avoid unnecessary re-renders
  const MemoizedHeader = useMemo(
    () => (
      <Header
        userData={userData}
        isDateClicked={isDateClicked}
        setIsDateClicked={setIsDateClicked}
        availabilityData={availabilityData}
        whichMonth={whichMonth}
        setWhichMonth={setWhichMonth}
        setMainPageMonth={setMainPageMonth}
      />
    ),
    [userData, isDateClicked, availabilityData, whichMonth, setMainPageMonth]
  );

  // Initialize Telegram WebApp
  useTelegramWebApp(setUserData);

  return (
    <ErrorBoundary>
      <Router>
        <Suspense fallback={<div>Loading...</div>}>
          {true ? (
            <div className="App">
              {/* Header Component */}
              {MemoizedHeader}

              {/* Main Menu Component */}
              <MainMenu
                isMoreClicked={isMoreClicked}
                setIsMoreClicked={setIsMoreClicked}
              />

              {/* Telegram Money Monitor Component */}
              <Telegram
                isDateClicked={isDateClicked}
                isMoreClicked={isMoreClicked}
                setIsMoreClicked={setIsMoreClicked}
                isAddClicked={isAddClicked}
                setIsAddClicked={setIsAddClicked}
                mainPageMonth={mainPageMonth}
                setMainPageMonth={setMainPageMonth}
                mainSelected={mainSelected}
                Availability={availabilityData}
                netAmountsData={netAmountsData}
                transactions={transactionsData}
                setWhichMonth={setWhichMonth}
              />

              {/* Routing for Transactions and AddTransaction */}
              <Routes>
                <Route path="/" element={<div />} />
                <Route
                  path="/Transactions"
                  element={
                    <Transactions
                      isMoreClicked={isMoreClicked}
                      setIsMoreClicked={setIsMoreClicked}
                      monthData={monthData}
                      whichMonth={whichMonth}
                      setWhichMonth={setWhichMonth}
                      userId={userData.userId}
                      isDateClicked={isDateClicked}
                    />
                  }
                />
                <Route
                  path="/AddTransaction"
                  element={
                    <AddTransaction
                      isAddClicked={isAddClicked}
                      setIsClicked={setIsAddClicked}
                      setIsAddClicked={setIsAddClicked}
                      userId={userData.userId}
                    />
                  }
                />
                <Route path="/Insight" element={<Insight />} />
                <Route path="/Account" element={<Account />} />
              </Routes>
            </div>
          ) : (
            <div>Loading data...</div>
          )}
        </Suspense>
      </Router>
    </ErrorBoundary>
  );
};

export default App;
