import "./App.css";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import Header from "./Header/header";
import { useTransactionData } from "./Tools/tools";

const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));
const Transactions = lazy(() => import("./Transactions/Transactions"));
const AddTransaction = lazy(() => import("./AddTransaction/AddTransaction"));

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

  const [whichMonth, setWhichMonth] = useState(0);
  const monthData = useTransactionData(
    whichMonth,
    userData.userId ? userData.userId : 90260003
  );
  console.log("Hello world!");


  const [isMoreClicked, setIsMoreClicked] = useState(null);
  const [isAddClicked, setIsAddClicked] = useState(null);

  return (
    <Router>
      <div className="App">
        <Suspense>
          <Header userData={userData} />
          <Telegram
            isMoreClicked={isMoreClicked}
            setIsMoreClicked={setIsMoreClicked}
            isAddClicked={isAddClicked}
            setIsAddClicked={setIsAddClicked}
          />
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
                />
              }
              userId={userData.userId}
            />
            <Route
              path="/AddTransaction"
              element={
                <AddTransaction
                  isAddClicked={isAddClicked}
                  setIsClicked={setIsAddClicked}
                  setIsAddClicked={setIsAddClicked}
                />
              }
              userId={userData.userId}
            />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
