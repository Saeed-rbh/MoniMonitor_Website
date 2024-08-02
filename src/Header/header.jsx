import React, { useState } from "react";
import "./header.css";
import MenuButton from "./MenuButton";

function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  return (
    <header className="MoneyMonitor_header">
      <div className="MoneyMonitor_User">
        <div className="MoneyMonitor_Logo">
          <img
            src={`${process.env.PUBLIC_URL}/MoneyMonitor.jpg`}
            alt="MoneyMonitor Logo"
          />
        </div>
        <p>
          <span>Money Monitor</span>
          <span>965896521</span>
        </p>
      </div>
      <MenuButton handleButtonClick={setIsMenuOpen} isMenuOpen={isMenuOpen} />
    </header>
  );
}

export default Header;
