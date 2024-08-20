import React, { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import Header from "./Header/header";
import { useTransactionData } from "./Tools/tools";
import { Authenticator } from "@aws-amplify/ui-react";
import { Amplify } from "aws-amplify";
import "@aws-amplify/ui-react/styles.css";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_aqztaf6m6",
      userPoolClientId: "25oppv2tmjh2jvdi4mk2ta4qj8",
      identityPoolId: "us-east-1:9d46d8b0-7d95-4dfb-a0d8-c29d2897e6bf",
      loginWith: {
        email: true,
      },
      signUpVerificationMethod: "code",
      userAttributes: {
        email: {
          required: true,
        },
      },
      allowGuestAccess: true,
      passwordFormat: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialCharacters: true,
      },
    },
  },
});

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
    <Authenticator>
      {({ signOut, user }) => (
        <main>
          <Router>
            <div className="App">
              {" "}
              <Suspense>
                {" "}
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
        </main>
      )}
    </Authenticator>
  );
};

export default App;

// import "./App.css";
// import React, { lazy, Suspense, useEffect, useState } from "react";
// import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
// import Header from "./Header/header";
// import { useTransactionData } from "./Tools/tools";

// const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));
// const Transactions = lazy(() => import("./Transactions/Transactions"));
// const AddTransaction = lazy(() => import("./AddTransaction/AddTransaction"));

// function App() {
//   const [userData, setUserData] = useState({
//     userId: "",
//     userName: "",
//     userUsername: "",
//     userLanguage: "",
//     queryId: "",
//   });

//   useEffect(() => {
//     const initTelegramWebApp = () => {
//       if (window.Telegram && window.Telegram.WebApp) {
//         const telegram = window.Telegram.WebApp;
//         const user = telegram.initDataUnsafe.user;
//         const queryId = telegram.initDataUnsafe.query_id;
//         if (queryId) {
//           setUserData({
//             userId: user.id,
//             userName: user.first_name,
//             userUsername: user.username,
//             userLanguage: user.language_code,
//             queryId: queryId,
//           });
//         }
//       }
//     };
//     initTelegramWebApp();
//   }, []);

//   const [whichMonth, setWhichMonth] = useState(0);
//   const monthData = useTransactionData(
//     whichMonth,
//     userData.userId ? userData.userId : 90260003
//   );

//   const [isMoreClicked, setIsMoreClicked] = useState(null);
//   const [isAddClicked, setIsAddClicked] = useState(null);

//   return (
//     <Router>
//       <div className="App">
//         <Suspense>
//           <Header userData={userData} />
//           <Telegram
//             isMoreClicked={isMoreClicked}
//             setIsMoreClicked={setIsMoreClicked}
//             isAddClicked={isAddClicked}
//             setIsAddClicked={setIsAddClicked}
//           />
//           <Routes>
//             <Route path="/" element={<div />} />

//             <Route
//               path="/Transactions"
//               element={
//                 <Transactions
//                   isMoreClicked={isMoreClicked}
//                   setIsMoreClicked={setIsMoreClicked}
//                   monthData={monthData}
//                   whichMonth={whichMonth}
//                   setWhichMonth={setWhichMonth}
//                 />
//               }
//               userId={userData.userId}
//             />
//             <Route
//               path="/AddTransaction"
//               element={
//                 <AddTransaction
//                   isAddClicked={isAddClicked}
//                   setIsClicked={setIsAddClicked}
//                   setIsAddClicked={setIsAddClicked}
//                 />
//               }
//               userId={userData.userId}
//             />
//           </Routes>
//         </Suspense>
//       </div>
//     </Router>
//   );
// }

// export default App;
