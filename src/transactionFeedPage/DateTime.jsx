import React, { useEffect } from "react";
import { useSpring, animated } from "react-spring";
import DatePicker from "../Tools/DatePicker";
import TimePicker from "../Tools/TimePicker";
import useLongPressHandler from "../Tools/useLongPressHandler";
import { MdModeEditOutline } from "react-icons/md";
import MoreDateTime from "./MoreDateTime";

const DateTime = ({
  isLongPress,
  selectedDate,
  setSelectedDate,
  currentDate,
  submit,
  setIsLongPress,
  isAddClicked,
  addStage,
  setAddStage,
  index,
  topAdd,
  opacity,
}) => {
  useEffect(() => {
    setAddStage(index);
  }, []);
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
  }, []);

  // console.log(selectedDate);

  const fade = useSpring({
    from: {
      // filter: !isLongPress ? "blur(10px)" : "blur(0px)",
      position: "absolute",
    },
    to: {
      filter:
        addStage === null
          ? "blur(0px)"
          : addStage < index || opacity
          ? "blur(10px)"
          : !isLongPress
          ? "blur(0px)"
          : "blur(0px)",
      position: "absolute",
      top: 180,
      y: topAdd,
      height: addStage === index ? 200 : 100,
      zIndex: 100000,
      opacity: opacity ? 0.5 : 1,
    },
  });

  const labelPar = useSpring({
    position: "absolute",
    height: 100,
    top: 5,
    left: 0,
    margin: 0,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    flexDirection: "column",
    margin: 0,
  });

  const label = useSpring({
    position: "relative",
    color: "var(--Bc-2)",
    borderRadius: "18px",
    width: addStage !== index ? 35 : 70,
    height: 45,
    width: 45,
    display: "flex",
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    marginTop: addStage !== index ? 15 : 15,
    cursor: addStage !== index ? "pointer" : "auto",
    backgroundColor: "var(--Ec-2)",
    left: 7,
    top: 7,
    flexDirection: "column",
  });

  const labelTitle = useSpring({
    top: addStage > index ? 33 : 33,
    left: addStage > index ? 48 : 48,
    width: "max-content",
    margin: 0,
    position: "absolute",
    color: "var(--Bc-1)",
    padding: "5px 10px",
    borderRadius: "30px",
    display: "flex",
    alignItems: "center",
    fontSize: "0.7rem",
  });
  // {...longBind()}
  return (
    <animated.li className="Add_DateTime" style={fade}>
      <h1>
        <div className="Add_background"></div>
        <animated.div style={labelPar}>
          <animated.h4 style={label}>
            <MdModeEditOutline />
          </animated.h4>
        </animated.div>
        <animated.label style={labelTitle}>
          Time:{" "}
          <TimePicker
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            submit={submit}
            addStage={addStage}
          />
        </animated.label>
        <div className="Add_edit">Transaction Time</div>
      </h1>
      <h1>
        <div className="Add_background"></div>
        <animated.div style={labelPar}>
          <animated.h4 style={label}>
            <MdModeEditOutline />
          </animated.h4>
        </animated.div>
        <animated.label style={labelTitle}>
          Date:{" "}
          <DatePicker
            setSelectedDate={setSelectedDate}
            selectedDate={selectedDate}
            maxDate={selectedDate}
            submit={submit}
            addStage={addStage}
          />
        </animated.label>
        <div className="Add_edit">Transaction Date</div>
      </h1>
      {addStage === 3 && (
        <MoreDateTime
          isLongPress={addStage === index}
          setIsLongPress={setIsLongPress}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
        />
      )}
    </animated.li>
  );
};

export default DateTime;
