import "./App.css";
import React, { lazy, Suspense } from "react";
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { TransactionProvider } from "./context/TransactionContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary";
import MainMenu from "./components/MainMenu/MainMenu";
import Header from "./components/Header/header";

// Lazy-loaded components
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const Transactions = lazy(() => import("./pages/Transactions/Transactions"));
const AddTransaction = lazy(() => import("./pages/AddTransaction/AddTransaction"));
const Telegram = lazy(() => import("./pages/Dashboard/MoneyMonitor"));
const Insight = lazy(() => import("./pages/Insight/Insight"));
const Account = lazy(() => import("./pages/Account/Account"));
const Finance = lazy(() => import("./pages/Finance/Finance"));
const SaveInvestAccounts = lazy(() => import("./pages/SaveInvest/SaveInvest"));
const SaveInvestInsights = lazy(() => import("./pages/SaveInvest/SaveInvestInsights"));
const AccountTransactions = lazy(() => import("./pages/SaveInvest/AccountTransactions"));

const BrandedLoader = ({ label = "Loading MoniMonitor" }) => (
  <div className="MoniLoader" role="status" aria-label={label}>
    <div className="MoniLoader_Content">
      <img className="MoniLoader_Logo" src="/monimonitor-logo.png" alt="MoniMonitor" />
      <div className="MoniLoader_Track" aria-hidden="true" />
      <span className="MoniLoader_SrOnly">{label}</span>
    </div>
  </div>
);

const DashboardSkeleton = () => (
  <div className="DashboardSkeleton" role="status" aria-label="Loading your dashboard">
    <div className="DashboardSkeleton_Hero" />
    <div className="DashboardSkeleton_Stats">
      <span />
      <span />
      <span />
    </div>
    <div className="DashboardSkeleton_List">
      <span />
      <span />
      <span />
    </div>
    <span className="MoniLoader_SrOnly">Loading your dashboard</span>
  </div>
);

// Private Route Component
const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <BrandedLoader label="Checking your session" />;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

// Layout for authenticated routes
const AuthenticatedLayout = () => {
  return (
    <div className="App">
      <Header />
      <div style={{ flex: 1, width: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Suspense fallback={<DashboardSkeleton />}>
          <Routes>
            <Route path="/" element={<Telegram />} />
            <Route path="/Transactions" element={<><Telegram /><Transactions /></>} />
            <Route path="/AddTransaction" element={<AddTransaction />} />
            <Route path="/Insight" element={<Insight />} />
            <Route path="/Profile" element={<Account />} />
            <Route path="/Account" element={<Navigate to="/Profile" replace />} />
            <Route path="/Finance" element={<Finance />} />
            <Route path="/Accounts" element={<SaveInvestInsights />} />
            <Route path="/Accounts/Manage" element={<SaveInvestAccounts />} />
            <Route
              path="/Accounts/:accountId/Transactions"
              element={<><SaveInvestInsights /><AccountTransactions /></>}
            />
            <Route path="/SaveInvest" element={<Navigate to="/Accounts" replace />} />
            <Route path="/SaveInvest/Accounts" element={<Navigate to="/Accounts/Manage" replace />} />
          </Routes>
        </Suspense>
      </div>
      <MainMenu />
    </div>
  );
};

const AppRoutes = () => {
  const { loading } = useAuth();

  if (loading) return <BrandedLoader label="Checking your session" />;

  return (
    <Router>
      <Suspense fallback={<BrandedLoader label="Loading page" />}>
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
  );
};

const App = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
