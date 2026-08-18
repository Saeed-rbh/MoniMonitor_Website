import React, { useState, useEffect, useCallback } from "react";
import { useSpring, animated, config } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { ScalableElement } from "../../utils/tools";
import { getTransactionIcon } from "../../components/Categories";
import { getTransactionDisplayReason } from "../../utils/transactionDisplay";

const formatMoney = (val) => {
  const num = Number(val || 0);
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(Math.abs(num));
};

const formatTransactionDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
};

const TransactionListItem = ({
  description,
  time,
  amount,
  isSwiped,
  onClick,
  category,
  label,
  type,
  isAddClicked,
  setOpen,
  setShowTransaction,
}) => {
  const ModifyLabel = getTransactionIcon(category, label);
  const displayReason = getTransactionDisplayReason(description, label);
  const isIncome = category === "Income" || type === "Income" || String(type || "").toLowerCase() === "credit";
  const direction = category === "Internal" ? "neutral" : isIncome ? "in" : "out";

  const [visibleButton, setVisibleButton] = useState("M");
  const [showLeftActions, setLeftShowActions] = useState(false);
  const [showRightActions, setRightShowActions] = useState(false);

  const [isScaled, setIsScaled] = useState(false);

  const handleMouseDown = useCallback(() => setIsScaled(true), []);
  const handleMouseUp = useCallback(() => setIsScaled(false), []);

  const bind = useDrag(
    ({ down, movement: [mx], tap, memo = false, elapsedTime }) => {
      if (!down && Math.abs(mx) < 5 && elapsedTime < 200 && onClick) {
        onClick();
      }
      if (!down && mx < -50) {
        if (visibleButton === "R" || visibleButton === "RR") {
          setVisibleButton("M");
        } else if (visibleButton === "L") {
          setVisibleButton("LL");
          setLeftShowActions(true);
        } else {
          setVisibleButton("L");
          setLeftShowActions(true);
        }
      }
      if (!down && mx > 50) {
        if (visibleButton === "L" || visibleButton === "LL") {
          setVisibleButton("M");
        } else if (visibleButton === "R") {
          setVisibleButton("RR");
          setRightShowActions(true);
        } else {
          setVisibleButton("R");
          setRightShowActions(true);
        }
      }

      return memo;
    },
    { axis: "x", filterTaps: true }
  );

  const [finalDel, setFinalDel] = useState(false);
  const handleDelRest = () => {
    if (showLeftActions && visibleButton === "M") {
      setLeftShowActions(false);
    } else if (showLeftActions && visibleButton === "LL") {
      setFinalDel(true);
    }
  };
  const swipeDelAction = useSpring({
    transform:
      visibleButton === "L"
        ? "translateX(90px)"
        : visibleButton === "LL"
          ? "translateX(380px)"
          : "translateX(90px)",
    width: visibleButton === "LL" ? "340px" : "80px",
    opacity: finalDel
      ? 0
      : visibleButton === "L" || visibleButton === "LL"
        ? 1
        : 0,
    config: visibleButton === "LL" ? config.default : config.slow,
    onRest: () => handleDelRest(),
  });

  const [finalMod, setFinalMod] = useState(false);
  const [resetMod, setResetMod] = useState(false);
  const handleModRest = () => {
    if (showRightActions && visibleButton === "M") {
      setRightShowActions(false);
    } else if (showRightActions && visibleButton === "RR") {
      onClick();
      setFinalMod(true);
    }
    if (finalMod === true) {
      setResetMod(true);
    }
  };
  const swipeModAction = useSpring({
    transform:
      visibleButton === "R"
        ? "translateX(-90px)"
        : visibleButton === "RR"
          ? "translateX(-385px)"
          : "translateX(-100px)",
    width: visibleButton === "RR" ? "350px" : "80px",
    opacity: finalMod
      ? 0
      : visibleButton === "R" || visibleButton === "RR"
        ? 1
        : 0,
    config: visibleButton === "RR" ? config.default : config.slow,
    onRest: () => handleModRest(),
  });

  const [isdeleted, setIsDeleted] = useState(false);
  const handlecomplete = () => {
    if (visibleButton === "LL") {
      setIsDeleted(true);
    }
  };
  const handleResolve = () => {
    if (visibleButton === "LL") {
      setShowTransaction({
        Amount: amount,
        Category: category,
        Label: label,
        Reason: description,
        Timestamp: time,
        Type: type,
        icon: ModifyLabel,
      });
      setOpen("delete");
      setVisibleButton("M");
    }
  };

  const swipeStyle = useSpring({
    transform:
      visibleButton === "L" && !resetMod
        ? "translateX(-90px)"
        : visibleButton === "LL" && !resetMod
          ? "translateX(-380px)"
          : visibleButton === "R" && !resetMod
            ? "translateX(90px)"
            : visibleButton === "RR" && !resetMod
              ? "translateX(380px)"
              : "translateX(0px)",
    touchAction: "pan-y",
    marginTop: finalDel || finalMod ? -52 : 0,
    opacity: finalDel || finalMod ? 0 : 1,
    scale: isScaled && !isSwiped ? 0.98 : 1,
    width: "100%",
    height: "52px",
    minHeight: "52px",
    display: "grid",
    gridTemplateColumns: "38px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "8px",
    boxSizing: "border-box",
    onRest: () => handlecomplete(),
    onResolve: () => handleResolve(),
  });

  useEffect(() => {
    if (isAddClicked === null) {
      setFinalMod(false);
      setResetMod(false);
      setVisibleButton("M");
    }
  }, [isAddClicked]);

  return (
    <>
      {!isdeleted && (
        <animated.li
          {...bind()}
          className="AccountTransactions_Row TransactionList_ItemRow"
          style={swipeStyle}
          onClick={() => { if (onClick) onClick(); }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
        >
          {showRightActions && (
            <ScalableElement
              as="div"
              className="modify-button"
              style={swipeModAction}
            >
              Modify
            </ScalableElement>
          )}
          <div className="AccountTransactions_Icon" aria-hidden="true">
            {ModifyLabel}
          </div>
          <div className="AccountTransactions_Reason">
            <strong>{displayReason || "Transaction"}</strong>
            <span>{formatTransactionDate(time)}</span>
          </div>
          <div className={`AccountTransactions_Amount ${direction}`}>
            <strong>
              {direction === "neutral" ? "" : direction === "in" ? "+" : "−"}
              {formatMoney(amount)}
            </strong>
            <span>{direction === "neutral" ? "transfer" : direction === "in" ? "in" : "out"}</span>
          </div>
          {showLeftActions && (
            <ScalableElement
              as="div"
              className="delete-button"
              style={swipeDelAction}
            >
              Delete
            </ScalableElement>
          )}
        </animated.li>
      )}
    </>
  );
};

export default TransactionListItem;
