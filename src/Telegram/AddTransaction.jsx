import React from "react";
import { animated } from "react-spring";
import { GoArrowUpRight, GoArrowDownLeft, GoPlus } from "react-icons/go";
import { ScalableElement } from "../Tools/tools";
import { useNavigate } from "react-router-dom";

const AddTransaction = ({ setIsAddClicked }) => {
  const redirect = useNavigate();

  const handleIncomeClick = () => {
    setIsAddClicked("Income");
    redirect("/AddTransaction");
  };
  const handleExpenseClick = () => {
    setIsAddClicked("Expense");
    redirect("/AddTransaction");
  };
  const handleSaveInvestClick = () => {
    setIsAddClicked("Save&Invest");
    redirect("/AddTransaction");
  };

  return (
    <nav className="MoneyMonitor_Menu">
      <p>
        Add <span>Transaction</span>
      </p>
      <ScalableElement as="h1" onClick={handleIncomeClick}>
        <GoArrowDownLeft color="var(--Fc-2)" />
        <animated.div
          style={{ opacity: 0.4 }}
          className="CirleColor"
        ></animated.div>
        <span>Income</span>
      </ScalableElement>
      <ScalableElement as="h1" onClick={handleExpenseClick}>
        <GoArrowUpRight color="var(--Gc-2)" />
        <animated.div
          style={{ opacity: 0.4 }}
          className="CirleColor"
        ></animated.div>

        <span>Expense</span>
      </ScalableElement>
      <ScalableElement as="h1" onClick={handleSaveInvestClick}>
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
