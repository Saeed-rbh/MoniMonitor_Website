import "./App.css";
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
  const { dataLoaded } = useTransactions();

  return dataLoaded ? (
    <div className="App">
      <Header />
      <Routes>
        <Route path="/" element={<Telegram />} />
        <Route path="/Transactions" element={<Transactions />} />
        <Route path="/AddTransaction" element={<AddTransaction />} />
        <Route path="/Insight" element={<Insight />} />
        <Route path="/Account" element={<Account />} />
      </Routes>
      <MainMenu />
    </div>
  ) : (
    <div className="flex justify-center items-center h-screen">Loading Transaction Data...</div>
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
