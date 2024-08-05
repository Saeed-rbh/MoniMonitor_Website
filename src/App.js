import "./App.css";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import Header from "./Header/header";

const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));
const Transactions = lazy(() => import("./Transactions/Transactions"));

function App() {
  const [userData, setUserData] = useState({
    userId: "",
    userName: "",
    userUsername: "",
    userLanguage: "",
    queryId: "",
  });

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
            queryId: queryId,
          });
        }
      }
    };
    initTelegramWebApp();
  }, []);

  console.log(!window.Telegram.WebApp);

  return (
    <Router>
      <div className="App">
        <Suspense>
          <Header userData={userData} />
          <Routes>
            <Route path="/" element={<Telegram />} />
            <Route
              path="/Transactions"
              element={<Transactions />}
              userId={userData.userId}
            />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
