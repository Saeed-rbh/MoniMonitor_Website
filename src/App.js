import "./App.css";
import React, { lazy, Suspense } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

const Telegram = lazy(() => import("./Telegram/MoneyMonitor"));

function App() {
  return (
    <Router>
      <div className="App">
        <Suspense fallback={<div>Loading...</div>}>
          <Routes>
            <Route path="/" element={<Telegram />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
