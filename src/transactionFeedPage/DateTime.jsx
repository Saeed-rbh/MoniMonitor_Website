import React, { useEffect } from "react";
import { useSpring, animated } from "react-spring";
import DatePicker from "../Tools/DatePicker";
import TimePicker from "../Tools/TimePicker";
import useLongPressHandler from "../Tools/useLongPressHandler";

const DateTime = ({
  isLongPress,
  selectedDate,
  setSelectedDate,
  currentDate,
  submit,
  setIsLongPress,
}) => {
  const longBind = useLongPressHandler({
    isLongPress: isLongPress,
    setIsLongPress: setIsLongPress,
    component: "DateTime",
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
    filter:
      isLongPress[0] && isLongPress[1] === "DateTime"
        ? "blur(10px)"
        : "blur(0px)",
  });

  return (
    <animated.li className="Add_DateTime" style={fade} {...longBind()}>
      <h1>
        <p>
          • Time <span></span>
        </p>
        <TimePicker
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          submit={submit}
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
          submit={submit}
        />
      </h1>
    </animated.li>
  );
};

export default DateTime;
