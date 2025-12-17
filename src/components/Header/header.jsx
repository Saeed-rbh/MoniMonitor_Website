import React from "react";
import "./header.css";
import ChooseMonth from "../ChooseMonth/ChooseMonth";
import BlurFade from "@/components/ui/blur-fade";
import { useTransactions } from "../../context/TransactionContext";

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

  const { userId, userName } = userData || {};

  return (
    <header className="MoneyMonitor_header" style={{ zIndex: 1000000 }}>
      <BlurFade delay={0.3 + 0.05 * 6} duration={0.3}>
        <ChooseMonth
          isDateClicked={isDateClicked}
          setIsDateClicked={setIsDateClicked}
          availabilityData={availabilityData}
          whichMonth={whichMonth}
          setWhichMonth={setWhichMonth}
          setMainPageMonth={setMainPageMonth}
        />
        <div className="MoneyMonitor_User">
          <div className="MoneyMonitor_Logo">
            <img
              src={`../../public/MoneyMonitor.jpg`}
              alt="MoneyMonitor Logo"
            />
          </div>
          <p>
            <span>{userName}</span>
            <span>{userId}</span>
          </p>
        </div>
      </BlurFade>
    </header>
  );
}

export default Header;
