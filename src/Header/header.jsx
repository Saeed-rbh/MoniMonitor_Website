import React, { useState } from "react";
import "./header.css";
import MenuButton from "./MenuButton";
import ChooseMonth from "../ChooseMonth/ChooseMonth";

function Header({
  userData,
  isDateClicked,
  setIsDateClicked,
  availabilityData,
  whichMonth,
  setWhichMonth,
  setMainPageMonth,
}) {
  const { userId, userName } = userData;
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="MoneyMonitor_header" style={{ zIndex: 1000000 }}>
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
          <img src={`../../public/MoneyMonitor.jpg`} alt="MoneyMonitor Logo" />
        </div>
        <p>
          <span>{userName}</span>
          <span>{userId}</span>
        </p>
      </div>
      {/* <MenuButton handleButtonClick={setIsMenuOpen} isMenuOpen={isMenuOpen} /> */}
    </header>
  );
}

export default Header;
