import "./App.css";
import React, { lazy, Suspense, useEffect, useState, useMemo } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { TransactionProvider, useTransactions } from "./context/TransactionContext";
import ErrorBoundary from "./components/ErrorBoundary";
import Transactions from "./pages/Transactions/Transactions";
import AddTransaction from "./pages/AddTransaction/AddTransaction";

// Lazy-loaded components
const MainMenu = lazy(() => import("./components/MainMenu/MainMenu"));
const Header = lazy(() => import("./components/Header/header"));
const Telegram = lazy(() => import("./pages/Dashboard/MoneyMonitor"));
const Insight = lazy(() => import("./pages/Insight/Insight"));
const Account = lazy(() => import("./pages/Account/Account"));

const App = () => {
  return (
    <ErrorBoundary>
      <TransactionProvider>
        <Router>
          <Suspense fallback={<div>Loading...</div>}>
            <AppContent />
          </Suspense>
        </Router>
      </TransactionProvider>
    </ErrorBoundary>
  );
};

const AppContent = () => {
  const { dataLoaded } = useTransactions();

  return dataLoaded ? (
    <div className="App">
      {/* Header Component */}
      <Header />

      {/* Telegram Money Monitor Component */}
      <Telegram />

      {/* Routing for Transactions and AddTransaction */}
      <Routes>
        <Route path="/" element={<div />} />
        <Route path="/Transactions" element={<Transactions />} />
        <Route path="/AddTransaction" element={<AddTransaction />} />
        <Route path="/Insight" element={<Insight />} />
        <Route path="/Account" element={<Account />} />
      </Routes>

      {/* Main Menu Component */}
      <MainMenu />
    </div>
  ) : (
    <div>Loading data...</div>
  );
};


export default App;
