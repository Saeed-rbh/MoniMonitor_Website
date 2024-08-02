import React from "react";
import { useSpring, animated } from "react-spring";
import {
  GoArrowUpRight,
  GoArrowDownLeft,
  GoPlus,
  GoPulse,
} from "react-icons/go";
import { formatNetTotal } from "./tools";

const MoneyEntryAmount = ({ type, transaction, setIsMoreClicked }) => {
  const BannerAmount =
    type === "Income"
      ? transaction.totalIncome
      : type === "Spending"
      ? transaction.totalSpending
      : type === "Save&Invest"
      ? transaction.totalSaving
      : transaction.netTotal;

  const amountStyle = {
    background:
      type === "Income"
        ? "linear-gradient(165deg, var(--Ec-4) 30%, var(--Fc-4) 100%)"
        : type === "Spending"
        ? "linear-gradient(165deg, var(--Ec-4) 30%, var(--Gc-4) 100%)"
        : type === "Save&Invest"
        ? "linear-gradient(165deg, var(--Ec-4) 30%, var(--Ac-4) 100%)"
        : "linear-gradient(165deg, var(--Ec-4) 30%, var(--Gc-4) 100%)",

    border:
      type === "Income"
        ? `1px solid var(--Fc-3)`
        : type === "Spending"
        ? `1px solid var(--Gc-3)`
        : type === "Save&Invest"
        ? `1px solid var(--Ac-3)`
        : `1px solid var(--Bc-3)`,
  };

  const gradientStyle = {
    background:
      type === "Income"
        ? "linear-gradient(165deg, var(--Ec-1) 30%, var(--Fc-2) 100%)"
        : type === "Spending"
        ? "linear-gradient(165deg, var(--Ec-1) 30%, var(--Gc-2) 100%)"
        : type === "Save&Invest"
        ? "linear-gradient(165deg, var(--Ec-1) 30%, var(--Ac-2) 100%)"
        : "linear-gradient(165deg, var(--Ec-1) 30%, var(--Bc-2) 100%)",
  };

  const ColorStyle = {
    color:
      type === "Income"
        ? "var(--Fc-2)"
        : type === "Spending"
        ? "var(--Gc-2)"
        : type === "Save&Invest"
        ? "var(--Ac-2)"
        : formatNetTotal(transaction.netTotal) > 0
        ? "var(--Fc-2)"
        : "var(--Gc-2)",
  };

  const [isScaled, setIsScaled] = React.useState(false);

  const handleMouseDown = () => {
    setIsScaled(true);
  };

  const handleMouseUp = () => {
    setIsScaled(false);
  };

  const widthFactor =
    type === "Save&Invest" ? 1.12 : type === "Balance" ? 0.88 : 1;
  const heightFactor = 0.98;
  const scaleStyle = useSpring({
    scale: isScaled ? 0.9 : 1,
    width: ((390 - 10) / 2) * widthFactor,
    height: ((390 - 20) / 2 / 1.6) * heightFactor,
  });

  return (
    <animated.div
      className="MoneyEntry_Amount"
      style={{ ...amountStyle, ...scaleStyle }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
      onClick={() => setIsMoreClicked(type)}
    >
      <div className="MoneyEntry_Amount_Gradient" style={gradientStyle}></div>

      <p>
        <span className={`MoneyEntry_Dot`} style={gradientStyle}></span>
        {type}
      </p>

      <div style={ColorStyle} className={`MoneyEntry_type_Open`}>
        {type === "Income" ? (
          <GoArrowDownLeft />
        ) : type === "Spending" ? (
          <GoArrowUpRight />
        ) : type === "Save&Invest" ? (
          <GoPlus />
        ) : (
          <GoPulse />
        )}
      </div>
      <div className="MoneyEntry_Balance">
        <h2>
          {type === "Save&Invest" || type === "Balance"
            ? "Total"
            : "Total Amount"}
          :
        </h2>
        <h1>
          {type === "Balance"
            ? formatNetTotal(BannerAmount) > 0
              ? "+"
              : "-"
            : ""}
          ${formatNetTotal(BannerAmount).replace("-", "")}
        </h1>
      </div>
    </animated.div>
  );
};

export default MoneyEntryAmount;
