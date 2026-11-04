import { useRemoteData } from './hooks/useRemoteData';
import { getEmailStatusAPI } from './services/apiService';
import { OperationalBanner, OperationalStatusPage } from './components/OperationalStatus';
import "./App.css";
import DataStatus from "./components/DataStatus";
import React, { lazy, Suspense } from "react";
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { TransactionProvider, useTransactions } from "./context/TransactionContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import Transactions from "./pages/Transactions/Transactions";
import AddTransaction from "./pages/AddTransaction/AddTransaction";

// Lazy-loaded components
const MainMenu = lazy(() => import("./components/MainMenu/MainMenu"));
const Header = lazy(() => import("./components/Header/header"));
const Telegram = lazy(() => import("./pages/Dashboard/MoneyMonitor"));
const Insight = lazy(() => import("./pages/Insight/Insight"));
const Account = lazy(() => import("./pages/Account/Account"));
const Finance = lazy(() => import("./pages/Finance/Finance"));
const SaveInvestAccounts = lazy(() => import("./pages/SaveInvest/SaveInvest"));
const SaveInvestInsights = lazy(() => import("./pages/SaveInvest/SaveInvestInsights"));

const TransactionSearch = lazy(() => import("./pages/Transactions/TransactionSearch"));

// Private Route Component
const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div>Loading...</div>;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

// Layout for authenticated routes
const AuthenticatedLayout = () => {
  const { dataLoaded, monthData, currency, currencies, setCurrency } = useTransactions();
  const { user } = useAuth();
  const operations = useRemoteData(getEmailStatusAPI, user?.userId);
  const location = useLocation();
  if (location.pathname === '/Status') return <div className="App"><OperationalStatusPage remote={operations} /><MainMenu /></div>;
  if (monthData.error && !monthData.lastUpdated) return <div><DataStatus {...monthData} /><OperationalBanner remote={operations} /></div>;

  return dataLoaded ? (
    <div className="App">
      <Header />
      <label style={{ color: 'var(--Ac-1)', padding: '6px 12px', fontSize: '14px' }}>Reporting currency{' '}
        <select aria-label="Reporting currency" value={currency} onChange={event => setCurrency(event.target.value)} style={{ minHeight: '44px', color: 'var(--Ac-1)', background: 'var(--Ec-4)' }}>
          {[...new Set([currency, ...currencies])].sort().map(code => <option key={code}>{code}</option>)}
        </select>
      </label>
      <DataStatus {...monthData} />
      <OperationalBanner remote={operations} />
      <div style={{ flex: 1, width: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Routes>
          <Route path="/" element={<Telegram />} />
          <Route path="/Status" element={<OperationalStatusPage remote={operations} />} />
          <Route path="/Transactions" element={<><Telegram /><Transactions /></>} />
          <Route path="/Search" element={<TransactionSearch />} />
          <Route path="/AddTransaction" element={<AddTransaction />} />
          <Route path="/Insight" element={<Insight />} />
          <Route path="/Account" element={<Account />} />
          <Route path="/Finance" element={<Finance />} />
          <Route path="/SaveInvest" element={<SaveInvestInsights />} />
          <Route path="/SaveInvest/Accounts" element={<SaveInvestAccounts />} />
        </Routes>
      </div>
      <MainMenu />
    </div>
  ) : (
    <div><OperationalBanner remote={operations} /><p role="status">Loading transaction data…</p></div>
  );
};

const App = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Suspense fallback={<div className="flex justify-center items-center h-screen">Loading...</div>}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              {/* Protected Routes */}
              <Route
                path="/*"
                element={
                  <PrivateRoute>
                    <TransactionProvider>
                      <AuthenticatedLayout />
                    </TransactionProvider>
                  </PrivateRoute>
                }
              />
            </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
