import "./App.css";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import Header from "./Header/header";

const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));

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

  return (
    <Router>
      <div className="App">
        <Suspense>
          <div style={{ color: "#fff", background: "#000" }}>
            <h1>Money Monitor</h1>
            <p>User ID: {userData.userId}</p>
            <p>User Name: {userData.userName}</p>
            <p>Username: {userData.userUsername}</p>
            <p>Language: {userData.userLanguage}</p>
            <p>Query ID: {userData.queryId}</p>
          </div>
          <Header userData={userData} />
          {/* <Routes>
            <Route path="/" element={<Telegram />} />
          </Routes> */}
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
