import React, { useState, useEffect, useMemo } from "react";
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
import MoreCategory from "./MoreCategory";
import MoreDateTime from "./MoreDateTime";
import {
  Expense_categories,
  Income_categories,
  SaveInvest_categories,
} from "../Tools/Categories";
import { useWindowHeight, ScalableElement } from "../Tools/tools";
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

  const [addStage, setAddStage] = useState(null);
  const [value, setValue] = useState("");
  const [valueError, setValueError] = useState(true);
  const [reason, setReason] = useState("");
  const [whichType, setWhichType] = useState(addTransaction.Type !== "Monthly");
  const [isLongPress, setIsLongPress] = useState([false, null]);

  /**
   * Date Management
   */
  const currentDate = new Date();
  const transactionDate = addTransaction?.Timestamp
    ? new Date(addTransaction.Timestamp)
    : currentDate;
  // console.log(addTransaction.Timestamp, transactionDate);
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

  const AutoDetect = ["Auto Detect", <MdOutlineAutoAwesome key="auto-icon" />];

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
   * Handlers
   */
  const handleAddClick = () => {
    if (value.length < 1 && !Modify) {
      setValueError(false);
    } else {
      setValueError(true);
      const selectedReason =
        reason.length !== 0 ? reason : addTransaction.Reason;
      const newTransaction = {
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

      // Set new transaction details and close add transaction modal
      setAddTransaction(newTransaction);
      setIsClicked(null);
      setModify(false);
      setOpen(true);
    }
  };

  const handleNext = () => {
    setAddStage((prev) => {
      const nextValue = null; //prev + 1;
      return nextValue > 4 ? null : nextValue;
    });
  };
  const handleLast = () => setAddStage((prev) => prev - 1);

  const [topAdd, setTopAdd] = useState(0);
  useEffect(() => {
    if (addStage === 0) setTopAdd(0);
    else if (addStage === 1 || addStage === null) setTopAdd(0);
    else if (addStage === 2) setTopAdd(-70);
    else if (addStage === 3) setTopAdd(-205);
    else if (addStage === 4) setTopAdd(-270);
  }, [addStage]);

  /**
   * Render Component
   */
  return (
    <animated.div className="AddTransactionFeed" style={fade}>
      <h3>
        <span style={DotStyle}>•</span>Add New{" "}
        <span>{isAddClicked?.replace("&", " & ")}</span>
      </h3>

      {/* Conditional rendering for MoreCategory and MoreDateTime components */}
      {isLongPress[0] && isLongPress[1] === "Category" && (
        <MoreCategory
          List={List}
          setSelectedCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
          defaultValue={Modify ? addTransaction.Label : ""}
          isLongPress={isLongPress}
          setIsLongPress={setIsLongPress}
        />
      )}
      {isLongPress[0] && isLongPress[1] === "DateTime" && (
        <MoreDateTime
          isLongPress={isLongPress}
          setIsLongPress={setIsLongPress}
        />
      )}

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
          setAddStage={setAddStage}
          index={0}
          topAdd={topAdd}
          opacity={addStage > 1 && addStage !== null}
        />
        {(addStage >= 1 || addStage === null) && (
          <Amount
            value={value}
            defaultValue={Modify ? addTransaction.Amount : ""}
            setValue={setValue}
            valueError={valueError}
            setAddStage={setAddStage}
            setValueError={setValueError}
            whichType={whichType}
            setWhichType={setWhichType}
            addStage={addStage}
            isAddClicked={isAddClicked}
            index={1}
            topAdd={topAdd}
          />
        )}
        {(addStage >= 2 || addStage === null) && (
          <Reason
            Reason={reason}
            setReason={setReason}
            addStage={addStage}
            defaultValue={Modify ? addTransaction.Reason : ""}
            isAddClicked={isAddClicked}
            setAddStage={setAddStage}
            index={2}
            topAdd={topAdd}
            opacity={addStage > 2 && addStage !== null}
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
            setAddStage={setAddStage}
            index={3}
            topAdd={topAdd}
            opacity={addStage > 3 && addStage !== null}
          />
        )}
        {/*{(addStage >= 4 || addStage === null) && (
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
          />
        )} */}

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
