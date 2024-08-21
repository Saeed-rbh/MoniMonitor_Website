import "./App.css";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import { fetchUserAttributes } from "aws-amplify/auth";
import { useTransactionData } from "./Tools/tools";

const SignUpComp = lazy(() => import("./auth/SignUpComp"));
const SignInComp = lazy(() => import("./auth/SignInComp"));
const SignOutComp = lazy(() => import("./auth/SignOutComp"));
const Header = lazy(() => import("./Header/header"));
const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));
const Transactions = lazy(() => import("./Transactions/Transactions"));
const AddTransaction = lazy(() => import("./AddTransaction/AddTransaction"));

const App = () => {
  const [userData, setUserData] = useState({
    userId: "",
    userName: "",
    userUsername: "",
    userLanguage: "",
    queryId: "",
  });

  const [sessionata, setSessionData] = useState(null);
  const [authState, setAuthState] = useState(sessionata === null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await fetchUserAttributes();
        setSessionData(data);
      } catch (error) {
        setSessionData(null);
      }
    };
    fetchData();
  }, [authState]);

  useEffect(() => {
    console.log("userDatasession is null:", sessionata === null);
    setAuthState(sessionata !== null);
  }, [sessionata, setAuthState]);

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
  const [isMoreClicked, setIsMoreClicked] = useState(null);
  const [isAddClicked, setIsAddClicked] = useState(null);
  return (
    <Router>
      <div className="App">
        <Suspense fallback={<div>Loading...</div>}>
          {authState && <Header userData={userData} />}
          {authState && (
            <Telegram
              isMoreClicked={isMoreClicked}
              setIsMoreClicked={setIsMoreClicked}
              isAddClicked={isAddClicked}
              setIsAddClicked={setIsAddClicked}
            />
          )}
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
            <Route path="/signup" element={<SignUpComp />} />
            {!authState && (
              <Route
                path="/signin"
                element={<SignInComp setAuthState={setAuthState} />}
              />
            )}
            {authState && (
              <Route
                path="/signout"
                element={<SignOutComp setAuthState={setAuthState} />}
              />
            )}
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
};

export default App;
