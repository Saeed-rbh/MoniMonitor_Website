import React, { useState, useEffect, useMemo } from "react";
import { useNumericInput } from "./useNumericInput";
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

function AddTransactionFeed({
  isAddClicked,
  setIsClicked,
  setAddTransaction,
  addTransaction,
  setModify,
  setOpen,
}) {
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

  const ModifyLabel = List.find((person) => person[0] === addTransaction.Label);
  const [selectedCategory, setSelectedCategory] = useState(
    Modify ? ModifyLabel : List[0]
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

  const [currentTime, setCurrentTime] = useState({
    hours: "",
    minutes: "",
    year: "",
    month: "",
    day: "",
  });

  useEffect(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const year = now.getFullYear();
    let month = now.getMonth() + 1;
    let day = now.getDate();

    month = month < 10 ? `0${month}` : month;
    day = day < 10 ? `0${day}` : day;

    setCurrentTime({
      hours: hours < 10 ? `0${hours}` : hours,
      minutes: minutes < 10 ? `0${minutes}` : minutes,
      year: year,
      month: month,
      day: day,
    });
  }, []);

  // const [hour] = useNumericInput("", 0, 23);
  // const [minute] = useNumericInput("", 0, 59);
  // const [day] = useNumericInput("", 1, 31);
  // const [month] = useNumericInput("", 1, 12);
  // const [year] = useNumericInput("", 2023, currentTime.year, true);

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
      console.log(newTransaction);

      setAddTransaction(newTransaction);
      setIsClicked(null);
      setModify(false);
      setOpen(true);
    }
  };

  const [isLongPress, setIsLongPress] = useState(false);
  const fade = useSpring({
    from: { opacity: isAddClicked !== null ? 0 : 1, height: `${height}px` },
    to: {
      opacity: isAddClicked !== null ? 1 : 0,
      height: `${height}px`,
    },
    // config: { duration: isLongPress ? 100 : 500 },
  });

  const moreBlurStyle = useSpring({
    filter: !isLongPress ? "blur(0px)" : "blur(10px)",
    scale: !isLongPress ? 1 : 0.9,
  });

  return (
    <animated.div className="AddTransactionFeed" style={fade}>
      <h3>
        <span style={DotStyle}>•</span>Add New{" "}
        <span>{isAddClicked?.replace("&", " & ")}</span>
      </h3>
      {isLongPress && (
        <MoreCategory
          List={List}
          setSelectedCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
          defaultValue={Modify ? addTransaction.Label : ""}
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
        />
        <Category
          List={List}
          setSelectedCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
          defaultValue={Modify ? addTransaction.Label : ""}
          isLongPress={isLongPress}
          setIsLongPress={setIsLongPress}
        />
        <Confirm handleAddClick={handleAddClick} isLongPress={isLongPress} />
      </animated.ul>
    </animated.div>
  );
}

export default AddTransactionFeed;
