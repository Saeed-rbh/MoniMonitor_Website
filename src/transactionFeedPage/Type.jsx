import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useSpring, animated } from "react-spring";
import { GoArrowUpRight, GoArrowDownLeft, GoPlus } from "react-icons/go";
import { ScalableElement } from "../Tools/tools";

const Type = ({
  value,
  setValue,
  valueError,
  setValueError,
  defaultValue,
  whichType,
  setWhichType,
}) => {
  console.log("Type", whichType);

  const handleIncomeClick = () => {
    setWhichType("Income");
  };
  const handleExpenseClick = () => {
    setWhichType("Expense");
  };
  const handleSaveInvestClick = () => {
    setWhichType("Save&Invest");
  };

  const colorStyle = useSpring({
    left:
      whichType === "Income"
        ? "calc(0% + 1px)"
        : whichType === "Expense"
        ? "calc(30% + 2px)"
        : "calc(60% + 3px)",
    width:
      whichType === "Income"
        ? "calc(30% - 0px)"
        : whichType === "Expense"
        ? "calc(30% - 0px)"
        : "calc(40% - 3px)",
  });

  return (
    <animated.li className="Add_Type">
      <ScalableElement
        as="h1"
        onClick={handleIncomeClick}
        // style={{
        //   background: whichType === "Income" ? "var(--Ec-4)" : "var(--Ec-2)",
        // }}
      >
        <GoArrowDownLeft color="var(--Fc-2)" />
        <span>Income</span>
      </ScalableElement>
      <ScalableElement
        as="h1"
        onClick={handleExpenseClick}
        // style={{
        //   background: whichType === "Expense" ? "var(--Ec-4)" : "var(--Ec-2)",
        // }}
      >
        <GoArrowUpRight color="var(--Gc-2)" />
        <span>Expense</span>
      </ScalableElement>
      <ScalableElement
        as="h1"
        onClick={handleSaveInvestClick}
        // style={{
        //   background:
        //     whichType === "Save&Invest" ? "var(--Ec-4)" : "var(--Ec-2)",
        // }}
      >
        <GoPlus color="var(--Ac-2)" />
        <span>Save & Invest</span>
      </ScalableElement>
      <animated.div
        className="Add_Type_color"
        style={colorStyle}
      ></animated.div>
    </animated.li>
  );
};

export default Type;
