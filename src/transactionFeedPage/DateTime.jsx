import React, { useEffect, useState } from "react";
import { useSpring, animated } from "react-spring";
import DatePicker from "../Tools/DatePicker";
import TimePicker from "../Tools/TimePicker";
const DateTime = ({
  currentTime,
  hour,
  minute,
  day,
  month,
  year,
  defaultValue,
  isLongPress,
}) => {
  const currentDate = new Date();
  const [selectedDate, setSelectedDate] = useState({
    year: String(currentDate.getFullYear()),
    month: String(currentDate.getMonth() + 1).padStart(2, "0"),
    day: String(currentDate.getDate()).padStart(2, "0"),
    hours: String(currentDate.getHours()).padStart(2, "0"),
    minutes: String(currentDate.getMinutes()).padStart(2, "0"),
    zone: String(currentDate.getTimezoneOffset()),
  });

  useEffect(() => {
    const inputTime = new Date(
      `${selectedDate.year}-${String(selectedDate.month).padStart(
        2,
        "0"
      )}-${String(selectedDate.day).padStart(2, "0")}T${String(
        selectedDate.hours
      ).padStart(2, "0")}:${String(selectedDate.minutes).padStart(2, "0")}`
    );
    if (inputTime > currentDate) {
      setSelectedDate({
        year: String(currentDate.getFullYear()),
        month: String(currentDate.getMonth() + 1).padStart(2, "0"),
        day: String(currentDate.getDate()).padStart(2, "0"),
        hours: String(currentDate.getHours()).padStart(2, "0"),
        minutes: String(currentDate.getMinutes()).padStart(2, "0"),
        zone: String(currentDate.getTimezoneOffset()),
      });
    }
  }, [selectedDate]);

  const fade = useSpring({
    filter: !isLongPress ? "blur(0px)" : "blur(10px)",
  });

  const Modify = defaultValue.length > 0;
  const getBorderStyle = (isValid) =>
    isValid ? {} : { border: "1px solid var(--Gc-2)" };

  const [ModifiedTime, setModifiedTime] = useState([
    false,
    false,
    false,
    false,
    false,
  ]);
  useEffect(() => {
    if (!ModifiedTime[0] && hour.value.length > 0) {
      hour.setIsValid(true);
      setModifiedTime([
        true,
        ModifiedTime[1],
        ModifiedTime[2],
        ModifiedTime[3],
      ]);
    }
    if (!ModifiedTime[1] && minute.value.length > 0) {
      minute.setIsValid(true);
      setModifiedTime([
        ModifiedTime[0],
        true,
        ModifiedTime[2],
        ModifiedTime[3],
      ]);
    }
    if (!ModifiedTime[2] && day.value.length > 0) {
      day.setIsValid(true);
      setModifiedTime([
        ModifiedTime[0],
        ModifiedTime[1],
        true,
        ModifiedTime[3],
      ]);
    }
    if (!ModifiedTime[3] && month.value.length > 0) {
      month.setIsValid(true);
      setModifiedTime([
        ModifiedTime[0],
        ModifiedTime[1],
        ModifiedTime[2],
        true,
      ]);
    }
    if (!ModifiedTime[4] && year.value.length > 0) {
      year.setIsValid(true);
      setModifiedTime([
        ModifiedTime[0],
        ModifiedTime[1],
        ModifiedTime[2],
        ModifiedTime[3],
        true,
      ]);
    }
  }, [currentTime]);

  return (
    <animated.li className="Add_DateTime" style={fade}>
      <h1>
        <p>
          • Time <span></span>
        </p>
        <TimePicker
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
        />
      </h1>
      <h1>
        <p>
          • Date <span></span>
        </p>
        <DatePicker
          setSelectedDate={setSelectedDate}
          selectedDate={selectedDate}
          maxDate={selectedDate}
        />
      </h1>
    </animated.li>
  );
};

export default DateTime;
