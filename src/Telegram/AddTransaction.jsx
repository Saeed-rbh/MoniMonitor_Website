import React from "react";
import { animated } from "react-spring";
import { GoArrowUpRight, GoArrowDownLeft, GoPlus } from "react-icons/go";
import { ScalableElement } from "./tools";

const AddTransaction = ({ setIsAddClicked }) => {
  return (
    <nav className="MoneyMonitor_Menu">
      <p>
        Add <span>Transaction</span>
      </p>
      <ScalableElement as="h1" onClick={() => setIsAddClicked("Income")}>
        <GoArrowDownLeft color="var(--Fc-2)" />
        <animated.div
          style={{ opacity: 0.4 }}
          className="CirleColor"
        ></animated.div>
        <span>Income</span>
      </ScalableElement>
      <ScalableElement as="h1" onClick={() => setIsAddClicked("Spending")}>
        <GoArrowUpRight color="var(--Gc-2)" />
        <animated.div
          style={{ opacity: 0.4 }}
          className="CirleColor"
        ></animated.div>

        <span>Spending</span>
      </ScalableElement>
      <ScalableElement as="h1" onClick={() => setIsAddClicked("Save&Invest")}>
        <GoPlus color="var(--Ac-2)" />
        <animated.div
          style={{ opacity: 0.4 }}
          className="CirleColor"
        ></animated.div>
        <span>Save & Invest</span>
      </ScalableElement>
    </nav>
  );
};

export default AddTransaction;
