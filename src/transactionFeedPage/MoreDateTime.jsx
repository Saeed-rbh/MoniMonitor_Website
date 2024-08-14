import React, { useRef, useState } from "react";
import { useSpring, animated, easings, useSprings } from "react-spring";
import useClickOutside from "../Tools/useClickOutside";
import {
  MdOutlineChevronLeft,
  MdOutlineChevronRight,
  MdKeyboardArrowDown,
} from "react-icons/md";
import { ScalableElement } from "../Tools/tools";

const Calendar = ({ month, year, selectedDay, setSelectedDay }) => {
  const daysOfWeek = ["S", "M", "T", "W", "T", "F", "S"];

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = new Date(year, month, 1).getDay();
  const calendarDays = [];
  for (let i = 0; i < startDay; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  const numberStyle = useSprings(
    calendarDays.length,
    calendarDays.map((day, index) => ({
      background:
        day !== null
          ? selectedDay === day
            ? "var(--Bc-3)"
            : "var(--Ec-3)"
          : "var(--Ec-4)",
      outline: day !== null ? "1px solid var(--Ac-3)" : "1px solid var(--Ec-4)",
    }))
  );

  console.log(
    selectedDay,
    (calendarDays.findIndex((day) => day === selectedDay) + 1) % 7
  );

  const nameStyle = useSprings(
    daysOfWeek.length,
    daysOfWeek.map((name, index) => ({
      background:
        selectedDay !== null &&
        (calendarDays.findIndex((day) => day === selectedDay) + 1) % 7 ===
          (index + 1) % 7
          ? "var(--Bc-3)"
          : "var(--Ec-2)",
    }))
  );

  return (
    <div className="calendar">
      <div className="day-names">
        {nameStyle.map((style, index) => (
          <animated.div key={index} className="day-name" style={style}>
            {daysOfWeek[index]}
          </animated.div>
        ))}
      </div>
      <div className="day-numbers">
        {numberStyle.map((style, index) => (
          <ScalableElement
            as="div"
            key={index}
            className="day-number"
            onClick={() => setSelectedDay(calendarDays[index])}
            style={style}
          >
            {calendarDays[index] !== null ? calendarDays[index] : ""}
          </ScalableElement>
        ))}
      </div>
    </div>
  );
};

const MoreDateTime = ({ isLongPress, setIsLongPress }) => {
  const [selectedDay, setSelectedDay] = useState(null);
  const containerRef = useRef(null);
  useClickOutside(containerRef, () => setIsLongPress(false));

  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  const Apear = useSpring({
    from: {
      opacity: isLongPress ? 0 : 1,
    },
    to: {
      opacity: !isLongPress ? 0 : 1,
      position: "absolute",
      height: "100%",
      width: "calc(100% - 10px)",
      margin: "0 5px",
      zIndex: 100,
      overflow: "visible",
      background: "none",
      outline: "none",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      flexDirection: "column",
    },
    config: { duration: 1000, easing: easings.easeOutExpo },
  });

  const handlePreviousMonth = () => {
    setSelectedDay(null);
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    setSelectedDay(null);
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  return (
    <>
      <animated.li className="MoreDateTime" style={Apear} ref={containerRef}>
        <div className="Calendar_header">
          <MdOutlineChevronLeft onClick={handlePreviousMonth} />
          <ScalableElement as="h1">
            <span>{monthNames[currentMonth]}</span> {currentYear}{" "}
            <MdKeyboardArrowDown />
          </ScalableElement>
          <MdOutlineChevronRight onClick={handleNextMonth} />
        </div>
        <Calendar
          month={currentMonth}
          year={currentYear}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
        />
      </animated.li>
    </>
  );
};

export default MoreDateTime;
