import React, { useEffect } from "react";
import { useSpring, animated } from "react-spring";
import DatePicker from "../Tools/DatePicker";
import TimePicker from "../Tools/TimePicker";
import useLongPressHandler from "../Tools/useLongPressHandler";
import { MdModeEditOutline } from "react-icons/md";

const DateTime = ({
  isLongPress,
  selectedDate,
  setSelectedDate,
  currentDate,
  submit,
  setIsLongPress,
  isAddClicked,
  addStage,
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
    // filter:
    //   isLongPress[0] && isLongPress[1] === "DateTime"
    //     ? "blur(10px)"
    //     : "blur(0px)",
    top: 149,
    // height: 500,
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
  const labelDot = useSpring({
    position: "relative",
    fontSize: "1.5em",
    color: "var(--Bc-2)",
    margin: "5px 10px 0px 17px",
    lineHeight: `15px`,
    width: 2,
    height: addStage > 2 ? 2 : 7,
    borderRadius: 30,
    background: "var(--Bc-2)",
  });
  const label = useSpring({
    position: "relative",
    fontSize: addStage !== 2 ? "1rem" : "0.7rem",
    color: "var(--Bc-2)",
    // border: "1px solid var(--Bc-2)",
    borderRadius: "30px",
    width: addStage !== 2 ? 35 : 70,
    height: 35,
    // padding: "10px 5px",
    display: "flex",
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    marginTop: addStage !== 2 ? 15 : 20,
    cursor: addStage !== 2 ? "pointer" : "auto",
  });

  const labelTitle = useSpring({
    top: addStage > 2 ? 27 : 30,
    left: addStage > 2 ? 30 : 75,
    width: "max-content",
    margin: 0,
    position: "absolute",
    fontSize: "0.7em",
    color: "var(--Bc-1)",
    padding: "5px 10px",
    borderRadius: "30px",
    display: "flex",
    alignItems: "center",
  });

  return (
    <animated.li className="Add_DateTime" style={fade} {...longBind()}>
      <h1>
        <animated.div style={labelPar}>
          <animated.h4 style={labelDot}></animated.h4>{" "}
          <animated.h4 style={label}>
            {addStage === 2 ? "Reason" : <MdModeEditOutline />}
          </animated.h4>
        </animated.div>
        <animated.label style={labelTitle}>
          {addStage === 2 && `What is the`} Time:{" "}
          <TimePicker
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            submit={submit}
            addStage={addStage}
          />
        </animated.label>
        <div className="Add_edit">
          <MdModeEditOutline /> Tap fot Edit
        </div>
      </h1>
      <h1>
        <animated.div style={labelPar}>
          <animated.h4 style={label}>
            {addStage === 2 ? "Reason" : <MdModeEditOutline />}
          </animated.h4>
        </animated.div>
        <animated.label style={labelTitle}>
          {addStage === 2 && `What is the`} Date:{" "}
          <DatePicker
            setSelectedDate={setSelectedDate}
            selectedDate={selectedDate}
            maxDate={selectedDate}
            submit={submit}
            addStage={addStage}
          />
        </animated.label>
      </h1>
    </animated.li>
  );
};

export default DateTime;
