import React from "react";
import "./header.css";
import ChooseMonth from "../ChooseMonth/ChooseMonth";
import BlurFade from "@/components/ui/blur-fade";
import { useTransactions } from "../../context/TransactionContext";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "react-router-dom";

function Header() {
  const {
    userData,
    isDateClicked,
    setIsDateClicked,
    availabilityData,
    whichMonth,
    setWhichMonth,
    setMainPageMonth,
  } = useTransactions();
  const location = useLocation();
  const { user } = useAuth(); // Get user from AuthContext

  return (
    <header className="MoneyMonitor_header" style={{ zIndex: 1000000 }}>
      <BlurFade delay={0.3 + 0.05 * 6} duration={0.3}>
        {/* Only show ChooseMonth on non-Account pages (assuming root / is dashboard) */}
        {location.pathname !== "/Account" && (
          <ChooseMonth
            isDateClicked={isDateClicked}
            setIsDateClicked={setIsDateClicked}
            availabilityData={availabilityData}
            whichMonth={whichMonth}
            setWhichMonth={setWhichMonth}
            setMainPageMonth={setMainPageMonth}
          />
        )}

        <div className="MoneyMonitor_User">
          <div className="MoneyMonitor_Logo">
            <img
              src={`../../public/MoneyMonitor.jpg`}
              alt="MoneyMonitor Logo"
            />
          </div>
          <p>
            <span>{user?.username}</span>
            <span>{user?.userId}</span>
          </p>
        </div>
      </BlurFade>
    </header>
  );
}

export default Header;
