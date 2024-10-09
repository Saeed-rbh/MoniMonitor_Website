import React, { useState, useEffect, useCallback } from "react";
import { useSpring, animated, config } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { ScalableElement } from "../Tools/tools";
import {
  Expense_categories,
  Income_categories,
  SaveInvest_categories,
} from "../Tools/Categories";

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
  const OriginalList =
    category === "Income"
      ? Income_categories
      : category === "Expense"
      ? Expense_categories
      : SaveInvest_categories;

  const ModifyLabel = OriginalList.find(
    (icon) => icon[0].toLowerCase() === label.toLowerCase()
  )[1];

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

  const clockTime = time.split(" ")[1];
  const dateArray = time.split(" ")[0].split("-");
  const date = new Date(dateArray[0], dateArray[1] - 1, dateArray[2]);
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  }).format(date);

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
    touchAction: "none",
    marginTop: finalDel || finalMod ? -55 : 0,
    opacity: finalDel || finalMod ? 0 : 1,
    scale: isScaled && !isSwiped ? 0.9 : 1,
    width: "calc(100% - 10px)",
    height: "55px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    onRest: () => handlecomplete(),
    onResolve: () => handleResolve(),
  });

  const truncateDescription = (description, maxLength = 30) => {
    if (description.length > maxLength) {
      return description.substring(0, maxLength - 3) + "...";
    } else {
      return description.padEnd(maxLength, " ");
    }
  };

  useEffect(() => {
    if (isAddClicked === null) {
      setFinalMod(false);
      setResetMod(false);
      setVisibleButton("M");
    }
  }, [isAddClicked]);

  const color =
    category === "Income"
      ? "var(--Fc-2)"
      : category === "Expense"
      ? "var(--Gc-2)"
      : "var(--Ac-2)";

  return (
    <>
      {!isdeleted && (
        <animated.li
          {...bind()}
          style={swipeStyle}
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
          <animated.p>
            <animated.span>{ModifyLabel}</animated.span>
            <div className="transaction-Description">
              <h4>{truncateDescription(description)}</h4>

              <h3>
                {dateArray[2]} | <span>{weekdayName}</span> - {clockTime}
              </h3>
            </div>
          </animated.p>
          <animated.p style={{ color: color }}>${amount}</animated.p>
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
