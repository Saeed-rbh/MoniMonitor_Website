import "./App.css";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));

function App() {
  const [userData, setUserData] = useState(null);
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

  return (
    <Router>
      <div className="App">
        <Suspense fallback={<div>Loading....</div>}>
          <Routes>
            <Route path="/" element={<Telegram />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
