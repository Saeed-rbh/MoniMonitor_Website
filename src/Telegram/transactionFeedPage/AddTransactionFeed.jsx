import React, { useState, useEffect } from "react";
import { useNumericInput } from "./useNumericInput";
import Amount from "./Amount";
import Reason from "./Reason";
import DateTime from "./DateTime";
import Category from "./Category";
import Confirm from "./Confirm";
import {
  spending_categories,
  Income_categories,
  SaveInvest_categories,
} from "./Categories";
import { useWindowHeight } from "../tools";
import { MdOutlineAutoAwesome } from "react-icons/md";
import { animated, useSpring } from "react-spring";

function AddTransactionFeed({
  isAddClicked,
  setIsClicked,
  setAddTransaction,
  addTransaction,
  setModify,
  setOpen,
}) {
  const Modify = addTransaction.Amount > 0 ? true : false;

  const height = Math.max(Math.min(useWindowHeight(160), 500), 470);

  const OriginalList =
    isAddClicked === "Income"
      ? Income_categories
      : isAddClicked === "Spending"
      ? spending_categories
      : SaveInvest_categories;

  const AutoDetect = ["Auto Detect", <MdOutlineAutoAwesome />];
  const List = [AutoDetect, ...OriginalList];
  const ModifyLabel = List.find((person) => person[0] === addTransaction.Label);
  const [selectedCategory, setSelectedCategory] = useState(
    Modify ? ModifyLabel : List[0]
  );

  const DotStyle = {
    color:
      isAddClicked === "Income"
        ? "var(--Fc-2)"
        : isAddClicked === "Spending"
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

  const [hour] = useNumericInput("", 0, 23);
  const [minute] = useNumericInput("", 0, 59);
  const [day] = useNumericInput("", 1, 31);
  const [month] = useNumericInput("", 1, 12);
  const [year] = useNumericInput("", 2023, currentTime.year, true);

  const [whichType, setWhichType] = useState(
    addTransaction.Type === "Daily"
      ? true
      : addTransaction.Type === "Monthly"
      ? false
      : true
  );

  const handleAddClick = () => {
    value.length < 1 && !Modify ? setValueError(false) : setValueError(true);
    if (value.length > 0 || Modify) {
      const yearSave =
        year.value.length < 1
          ? Modify
            ? addTransaction.Timestamp.split(" ")[0].split("-")[0]
            : currentTime.year
          : year.value;
      const monthSave =
        month.value.length < 1
          ? Modify
            ? addTransaction.Timestamp.split(" ")[0].split("-")[1]
            : currentTime.month
          : month.value;
      const daySave =
        day.value.length < 1
          ? Modify
            ? addTransaction.Timestamp.split(" ")[0].split("-")[2]
            : currentTime.day
          : day.value;
      const hourSave =
        hour.value.length < 1
          ? Modify
            ? addTransaction.Timestamp.split(" ")[1].split(":")[0]
            : currentTime.hours
          : hour.value;
      const minuteSave =
        minute.value.length < 1
          ? Modify
            ? addTransaction.Timestamp.split(" ")[1].split(":")[1]
            : currentTime.minutes
          : minute.value;

      const selectedReason =
        reason.length !== 0 ? reason : addTransaction.Reason;

      // if (selectedCategory[0] === "Auto Detect") {
      //   fetchLabel({
      //     reason: selectedReason,
      //     type: isAddClicked,
      //   });
      // }
      const newTransaction = {
        Amount:
          Number(value.replace(/[^0-9]/g, "")) !== 0
            ? Number(value.replace(/[^0-9]/g, ""))
            : addTransaction.Amount,
        Reason: selectedReason,
        Label: selectedCategory[0],
        Timestamp: `${yearSave}-${monthSave}-${daySave} ${hourSave}:${minuteSave}`,
        Type: whichType ? "Daily" : "Monthly",
        Category: isAddClicked,
      };

      setAddTransaction(newTransaction);
      setIsClicked(null);
      setModify(false);
      setOpen(true);
    }
  };

  const fade = useSpring({
    from: { opacity: isAddClicked !== null ? 0 : 1, height: `${height}px` },
    to: { opacity: isAddClicked !== null ? 1 : 0, height: `${height}px` },
    config: { duration: 500 },
  });

  // const [autoLabel, setAutoLabel] = useState("");
  // const fetchLabel = async (Data) => {
  //   const response = await fetch("/api/get-label", {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify(Data),
  //   });
  //   const data = await response.json();
  //   const autoLabel = List.find((item) => item[0] === data.label);
  //   setAutoLabel(autoLabel);
  // };
  // useEffect(() => {
  //   if (autoLabel.length > 0) {
  //     const newTransaction = {
  //       Amount: addTransaction.Amount,
  //       Reason: addTransaction.Reason,
  //       Label: autoLabel[0],
  //       Timestamp: addTransaction.Timestamp,
  //       Type: addTransaction.Type,
  //       Category: addTransaction.Category,
  //     };
  //     setAddTransaction(newTransaction);
  //   }
  // }, [autoLabel]);

  return (
    <animated.div className="AddTransactionFeed" style={fade}>
      <h3>
        <span style={DotStyle}>•</span>Add New <span>{isAddClicked}</span>
      </h3>

      <ul>
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
          currentTime={currentTime}
          hour={hour}
          day={day}
          minute={minute}
          month={month}
          year={year}
          defaultValue={Modify ? addTransaction.Timestamp : ""}
        />
        <Category
          List={List}
          setSelectedCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
          defaultValue={Modify ? addTransaction.Label : ""}
        />
        <Confirm handleAddClick={handleAddClick} />
      </ul>
    </animated.div>
  );
}

export default AddTransactionFeed;
