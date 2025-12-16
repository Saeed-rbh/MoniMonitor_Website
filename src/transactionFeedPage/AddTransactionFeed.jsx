import React, { useState, useMemo, useCallback, useReducer } from "react";
import { MdKeyboardArrowLeft, MdKeyboardArrowRight } from "react-icons/md";
import { FaCheck } from "react-icons/fa";
import { MdOutlineAutoAwesome } from "react-icons/md";
import { animated, useSpring } from "react-spring";

// Importing other components
import Amount from "./Amount";
import Reason from "./Reason";
import DateTime from "./DateTime";
import Category from "./Category";
import Type from "./Type";

import {
  Expense_categories,
  Income_categories,
  SaveInvest_categories,
} from "../components/Categories";
import { useWindowHeight, ScalableElement } from "../utils/tools";
import "./AddTransactionFeed.css";

function AddTransactionFeed({
  isAddClicked,
  setIsClicked,
  setAddTransaction,
  addTransaction,
  setModify,
  setOpen,
}) {
  /**
   * State Management
   */
  const [value, setValue] = useState("");
  const [valueError, setValueError] = useState(true);
  const [reason, setReason] = useState("");
  const [whichType, setWhichType] = useState(addTransaction.Type !== "Monthly");
  const [isLongPress, setIsLongPress] = useState([false, null]);

  const initialStageState = null;
  const stageReducer = (state, action) => {
    switch (action.type) {
      case "NEXT_STAGE":
        return state + 1 > 4 ? null : state + 1;
      case "PREV_STAGE":
        return state - 1;
      case "SET_STAGE":
        return action.stage;
      default:
        return state;
    }
  };
  const [addStage, dispatch] = useReducer(stageReducer, initialStageState);

  /**
   * Date Management
   */
  const currentDate = new Date();
  const transactionDate = useMemo(
    () =>
      addTransaction?.Timestamp
        ? new Date(addTransaction.Timestamp)
        : currentDate,
    [addTransaction]
  );

  const [selectedDate, setSelectedDate] = useState({
    year: String(transactionDate.getFullYear()),
    month: String(transactionDate.getMonth() + 1).padStart(2, "0"),
    day: String(transactionDate.getDate()).padStart(2, "0"),
    hours: String(transactionDate.getHours()).padStart(2, "0"),
    minutes: String(transactionDate.getMinutes()).padStart(2, "0"),
    zone: String(transactionDate.getTimezoneOffset()),
  });

  /**
   * Dynamic UI Height Calculation
   */
  const windowHeight = useWindowHeight(160);
  const height = useMemo(
    () => Math.max(Math.min(windowHeight, 500), 480),
    [windowHeight]
  );

  /**
   * Category List Determination
   */
  const OriginalList = useMemo(() => {
    switch (isAddClicked) {
      case "Income":
        return Income_categories;
      case "Expense":
        return Expense_categories;
      default:
        return SaveInvest_categories;
    }
  }, [isAddClicked]);

  const AutoDetect = useMemo(
    () => ["Auto Detect", <MdOutlineAutoAwesome key="auto-icon" />],
    []
  );
  const List = useMemo(
    () => [AutoDetect, ...OriginalList],
    [AutoDetect, OriginalList]
  );

  const Modify = addTransaction.Amount > 0;
  const [selectedCategory, setSelectedCategory] = useState(
    Modify
      ? List.find((item) => addTransaction.Label === item[0].toLowerCase())
      : List[0]
  );

  /**
   * Styling and Animations
   */
  const DotStyle = useMemo(
    () => ({
      color:
        isAddClicked === "Income"
          ? "var(--Fc-2)"
          : isAddClicked === "Expense"
            ? "var(--Gc-2)"
            : "var(--Ac-2)",
    }),
    [isAddClicked]
  );

  // Animation for fading the entire component in or out
  const fade = useSpring({
    from: { opacity: isAddClicked ? 0 : 1, height: `${height}px` },
    to: { opacity: isAddClicked ? 1 : 0, height: `${height}px` },
  });

  // Animation for adding blur effect when long press is active
  const moreBlurStyle = useSpring({
    marginTop: 10,
    filter: isLongPress[0] ? "blur(10px)" : "blur(0px)",
    scale: isLongPress[0] ? 0.9 : 1,
  });

  // Animation for button visibility based on add stage
  const buttonStyle = useSpring({
    opacity: addStage !== 0 ? 1 : 0,
    y: addStage !== 0 ? 0 : 10,
  });

  /**
   * Derived State
   */
  const topAdd = useMemo(() => {
    switch (addStage) {
      case 0:
      case 1:
        return 0;
      case 2:
        return -70;
      case 3:
        return -205;
      case 4:
        return -270;
      default:
        return 0;
    }
  }, [addStage]);

  /**
   * Handlers
   */
  const newTransactionMemo = useMemo(() => {
    const selectedReason = reason.length !== 0 ? reason : addTransaction.Reason;
    return {
      Amount:
        Number(value.replace(/[^0-9]/g, "")) !== 0
          ? Number(value.replace(/[^0-9]/g, ""))
          : addTransaction.Amount,
      Reason: selectedReason,
      Label: selectedCategory[0],
      Timestamp: `${selectedDate.year}-${selectedDate.month}-${selectedDate.day} ${selectedDate.hours}:${selectedDate.minutes}`,
      Type: whichType ? "Daily" : "Monthly",
      Category: isAddClicked,
    };
  }, [
    value,
    reason,
    addTransaction,
    selectedCategory,
    selectedDate,
    whichType,
    isAddClicked,
  ]);

  const handleAddClick = useCallback(() => {
    if (value.length < 1 && !Modify) {
      setValueError(false);
    } else {
      setValueError(true);
      setAddTransaction(newTransactionMemo);
      setIsClicked(null);
      setModify(false);
      setOpen(true);
    }
  }, [
    value,
    Modify,
    newTransactionMemo,
    setAddTransaction,
    setIsClicked,
    setModify,
    setOpen,
  ]);

  const handleNext = useCallback(() => {
    dispatch({ type: "NEXT_STAGE" });
  }, []);

  const handleLast = useCallback(() => {
    dispatch({ type: "PREV_STAGE" });
  }, []);

  const handleStage = useCallback(
    (stage) => {
      if (addStage === null) {
        dispatch({ type: "SET_STAGE", stage });
      }
    },
    [addStage]
  );

  /**
   * Render Component
   */
  return (
    <animated.div className="AddTransactionFeed" style={fade}>
      <h3>
        <span style={DotStyle}>•</span>Add New{" "}
        <span>{isAddClicked?.replace("&", " & ")}</span>
      </h3>
      {/* Main form elements */}
      <animated.ul style={moreBlurStyle}>
        <Type
          value={value}
          defaultValue={Modify ? addTransaction.Amount : ""}
          setValue={setValue}
          valueError={valueError}
          setValueError={setValueError}
          whichType={isAddClicked}
          setWhichType={setIsClicked}
          addStage={addStage}
          setAddStage={(stage) => dispatch({ type: "SET_STAGE", stage })}
          index={0}
          topAdd={topAdd}
          opacity={addStage > 1 && addStage !== null}
          handleStage={handleStage}
        />
        {(addStage >= 1 || addStage === null) && (
          <Amount
            value={value}
            defaultValue={Modify ? addTransaction.Amount : ""}
            setValue={setValue}
            valueError={valueError}
            setAddStage={(stage) => dispatch({ type: "SET_STAGE", stage })}
            setValueError={setValueError}
            whichType={whichType}
            setWhichType={setWhichType}
            addStage={addStage}
            isAddClicked={isAddClicked}
            index={1}
            topAdd={topAdd}
            handleStage={handleStage}
          />
        )}
        {(addStage >= 2 || addStage === null) && (
          <Reason
            Reason={reason}
            setReason={setReason}
            addStage={addStage}
            defaultValue={Modify ? addTransaction.Reason : ""}
            isAddClicked={isAddClicked}
            setAddStage={(stage) => dispatch({ type: "SET_STAGE", stage })}
            index={2}
            topAdd={topAdd}
            opacity={addStage > 2 && addStage !== null}
            handleStage={handleStage}
          />
        )}
        {(addStage >= 3 || addStage === null) && (
          <DateTime
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            currentDate={currentDate}
            isLongPress={isLongPress}
            setIsLongPress={setIsLongPress}
            addStage={addStage}
            setAddStage={(stage) => dispatch({ type: "SET_STAGE", stage })}
            index={3}
            topAdd={topAdd}
            opacity={addStage > 3 && addStage !== null}
            handleStage={handleStage}
          />
        )}
        {(addStage >= 4 || addStage === null) && (
          <Category
            List={List}
            setSelectedCategory={setSelectedCategory}
            selectedCategory={selectedCategory}
            defaultValue={Modify ? addTransaction.Label : ""}
            isLongPress={isLongPress}
            setIsLongPress={setIsLongPress}
            addStage={addStage}
            index={4}
            topAdd={topAdd}
            setAddStage={(stage) => dispatch({ type: "SET_STAGE", stage })}
            handleStage={handleStage}
          />
        )}

        {addStage !== 0 && (
          <animated.div
            style={buttonStyle}
            className="AddTransactionFeed_button"
          >
            <ScalableElement as="button" onClick={handleLast}>
              <MdKeyboardArrowLeft />
            </ScalableElement>
            <ScalableElement as="button" onClick={handleNext}>
              <MdKeyboardArrowRight />
              <span>Next</span>
            </ScalableElement>
            <ScalableElement as="button" onClick={handleAddClick}>
              <FaCheck />
              <span>Confirm</span>
            </ScalableElement>
          </animated.div>
        )}
      </animated.ul>
    </animated.div>
  );
}

export default AddTransactionFeed;
