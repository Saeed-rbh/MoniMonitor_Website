import "./App.css";
import React, { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));

function App() {
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    // Initialize the Telegram Web App
    const initTelegramWebApp = () => {
      const telegram = window.Telegram.WebApp;

      // Extract user and session information
      const user = telegram.initDataUnsafe.user;
      const queryId = telegram.initDataUnsafe.query_id;

      console.log("User ID:", user.id);
      console.log("User Name:", user.first_name);
      console.log("User Username:", user.username);
      console.log("User Language Code:", user.language_code);
      console.log("Session ID:", queryId);

      // Update the component state with user data
      setUserData({
        userId: user.id,
        userName: user.first_name,
        userUsername: user.username,
        userLanguage: user.language_code,
        queryId: queryId,
      });
    };

    // Call the function to initialize the Web App
    initTelegramWebApp();
  }, []);

  return (
    // <Router>
    <div className="App">
      <h1>Welcome to MoniMonitor</h1>
      {userData ? (
        <div>
          <p>User ID: {userData.userId}</p>
          <p>User Name: {userData.userName}</p>
          <p>Username: {userData.userUsername}</p>
          <p>Language Code: {userData.userLanguage}</p>
        </div>
      ) : (
        <p>Loading user data...</p>
      )}
      {/* //     <Suspense fallback={<div>Loading....</div>}>
    //       <Routes>
    //         <Route path="/" element={<Telegram />} />
    //       </Routes>
    //     </Suspense> */}
    </div>
    // </Router>
  );
}

export default App;
