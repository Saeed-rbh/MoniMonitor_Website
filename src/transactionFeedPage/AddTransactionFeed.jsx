import React, { useState, useEffect, useMemo, useRef } from "react";
import { MdKeyboardArrowLeft, MdKeyboardArrowRight } from "react-icons/md";
import { FaCheck } from "react-icons/fa";

import Amount from "./Amount";
import Reason from "./Reason";
import DateTime from "./DateTime";
import Category from "./Category";
import Confirm from "./Confirm";
import Type from "./Type";
import {
  Expense_categories,
  Income_categories,
  SaveInvest_categories,
} from "../Tools/Categories";
import { useWindowHeight } from "../Tools/tools";
import { MdOutlineAutoAwesome } from "react-icons/md";
import { animated, useSpring } from "react-spring";
import "./AddTransactionFeed.css";
import MoreCategory from "./MoreCategory";
import MoreDateTime from "./MoreDateTime";
import { ScalableElement } from "../Tools/tools";

function AddTransactionFeed({
  isAddClicked,
  setIsClicked,
  setAddTransaction,
  addTransaction,
  setModify,
  setOpen,
}) {
  const [addStage, setAddStage] = useState(5);
  const currentDate = new Date();
  const [selectedDate, setSelectedDate] = useState({
    year: String(currentDate.getFullYear()),
    month: String(currentDate.getMonth() + 1).padStart(2, "0"),
    day: String(currentDate.getDate()).padStart(2, "0"),
    hours: String(currentDate.getHours()).padStart(2, "0"),
    minutes: String(currentDate.getMinutes()).padStart(2, "0"),
    zone: String(currentDate.getTimezoneOffset()),
  });

  const Modify = addTransaction.Amount > 0 ? true : false;
  const height = Math.max(Math.min(useWindowHeight(160), 500), 480);

  const OriginalList = useMemo(() => {
    if (isAddClicked === "Income") {
      return Income_categories;
    } else if (isAddClicked === "Expense") {
      return Expense_categories;
    } else {
      return SaveInvest_categories;
    }
  }, [isAddClicked]);

  const AutoDetect = useMemo(
    () => ["Auto Detect", <MdOutlineAutoAwesome />],
    []
  );

  const List = useMemo(
    () => [AutoDetect, ...OriginalList],
    [AutoDetect, OriginalList]
  );

  const [selectedCategory, setSelectedCategory] = useState(
    Modify ? List.find((item) => addTransaction.Label === item[0]) : List[0]
  );

  const DotStyle = {
    color:
      isAddClicked === "Income"
        ? "var(--Fc-2)"
        : isAddClicked === "Expense"
        ? "var(--Gc-2)"
        : "var(--Ac-2)",
  };

  const [value, setValue] = useState("");

  const [valueError, setValueError] = useState(true);

  useEffect(() => {
    setValue("");
  }, [isAddClicked]);

  const [reason, setReason] = useState("");

  const [whichType, setWhichType] = useState(
    addTransaction.Type === "Daily"
      ? true
      : addTransaction.Type === "Monthly"
      ? false
      : true
  );

  const handleAddClick = async () => {
    value.length < 1 && !Modify ? setValueError(false) : setValueError(true);
    if (value.length > 0 || Modify) {
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

      setAddTransaction(newTransaction);
      setIsClicked(null);
      setModify(false);
      setOpen(true);
    }
  };

  const [isLongPress, setIsLongPress] = useState([false, null]);
  const fade = useSpring({
    from: { opacity: isAddClicked !== null ? 0 : 1, height: `${height}px` },
    to: {
      opacity: isAddClicked !== null ? 1 : 0,
      height: `${height}px`,
    },
  });

  const moreBlurStyle = useSpring({
    filter: !isLongPress[0] ? "blur(0px)" : "blur(10px)",
    scale: !isLongPress[0] ? 1 : 0.9,
  });

  const buttunStyle = useSpring({
    opacity: addStage !== 0 ? 1 : 0,
    y: addStage !== 0 ? 0 : 10,
  });

  const handleNext = () => {
    console.log(value);
    if (value.length > 0) {
      setAddStage(addStage + 1);
    } else {
      setValueError(false);
    }
  };

  const handleLast = () => {
    setAddStage(addStage - 1);
  };

  return (
    <animated.div className="AddTransactionFeed" style={fade}>
      <h3>
        <span style={DotStyle}>•</span>Add New{" "}
        <span>{isAddClicked?.replace("&", " & ")}</span>
      </h3>
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
        />
        <Amount
          value={value}
          defaultValue={Modify ? addTransaction.Amount : ""}
          setValue={setValue}
          valueError={valueError}
          setValueError={setValueError}
          whichType={whichType}
          setWhichType={setWhichType}
          addStage={addStage}
          isAddClicked={isAddClicked}
        />
        <Reason
          Reason={reason}
          setReason={setReason}
          addStage={addStage}
          defaultValue={Modify ? addTransaction.Reason : ""}
          isAddClicked={isAddClicked}
        />
        <DateTime
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          currentDate={currentDate}
          isLongPress={isLongPress}
          setIsLongPress={setIsLongPress}
          addStage={addStage}
        />
        <Category
          List={List}
          setSelectedCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
          defaultValue={Modify ? addTransaction.Label : ""}
          isLongPress={isLongPress}
          setIsLongPress={setIsLongPress}
          addStage={addStage}
        />

        {/*   <Type
          value={value}
          defaultValue={Modify ? addTransaction.Amount : ""}
          setValue={setValue}
          valueError={valueError}
          setValueError={setValueError}
          whichType={isAddClicked}
          setWhichType={setIsClicked}
        />
        <Amount
          value={value}
          defaultValue={Modify ? addTransaction.Amount : ""}
          setValue={setValue}
          valueError={valueError}
          setValueError={setValueError}
          whichType={whichType}
          setWhichType={setWhichType}
        />
        <Reason
          Reason={Reason}
          setReason={setReason}
          defaultValue={Modify ? addTransaction.Reason : ""}
        />
        <DateTime
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          currentDate={currentDate}
          isLongPress={isLongPress}
          setIsLongPress={setIsLongPress}
        />
        
        <Confirm handleAddClick={handleAddClick} isLongPress={isLongPress} /> */}
        {/* <Category
          List={List}
          setSelectedCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
          defaultValue={Modify ? addTransaction.Label : ""}
          isLongPress={isLongPress}
          setIsLongPress={setIsLongPress}
        /> */}
        {addStage !== 0 && (
          <animated.div
            style={buttunStyle}
            className="AddTransactionFeed_button"
          >
            <ScalableElement as="button" onClick={() => handleLast()}>
              <MdKeyboardArrowLeft />
            </ScalableElement>
            <ScalableElement as="button" onClick={() => handleNext()}>
              <MdKeyboardArrowRight />
              <span>Next</span>
            </ScalableElement>
            <ScalableElement as="button">
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
