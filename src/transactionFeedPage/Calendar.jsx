import React from "react";
import { ScalableElement } from "../utils/tools";
import { useSprings, animated } from "react-spring";

const Calendar = ({
  month,
  year,
  selectedDay,
  setSelectedDay,
  setSelectedDate,
}) => {
  const daysOfWeek = ["S", "M", "T", "W", "T", "F", "S"];

  // Calculate the days in the current month and start day of the month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDay = new Date(year, month, 1).getDay();

  // Generate the calendar days array
  const calendarDays = [];
  for (let i = 0; i < startDay; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  // Springs for the day numbers
  const numberStyle = useSprings(
    calendarDays.length,
    calendarDays.map((day) => ({
      background:
        day !== null
          ? parseInt(selectedDay) === day
            ? "var(--Bc-3)" // Highlight selected day
            : "var(--Ac-5)"
          : "var(--Ec-4)",
      outline: day !== null ? "1px solid var(--Ac-3)" : "1px solid var(--Ec-4)",
    }))
  );

  // Springs for the day names
  const nameStyle = useSprings(
    daysOfWeek.length,
    daysOfWeek.map((name, index) => ({
      background: "var(--Ec-4)",
      color:
        selectedDay !== null &&
        (calendarDays.findIndex((day) => day === parseInt(selectedDay)) + 1) %
          7 ===
          (index + 1) % 7
          ? "var(--Bc-1)"
          : "var(--Ac-2)",
    }))
  );

  // Directly handle the click on a day number
  const DayNumber = ({ key, day, style }) => (
    <ScalableElement
      as="div"
      key={key}
      className="day-number"
      onClick={() => {
        if (day !== null && day !== selectedDay) {
          setSelectedDay(day);
        }
      }}
      style={style}
    >
      {day !== null ? day : ""}
    </ScalableElement>
  );

  return (
    <>
      <div className="day-names">
        {nameStyle.map((style, index) => (
          <animated.div key={index} className="day-name" style={style}>
            {daysOfWeek[index]}
          </animated.div>
        ))}
      </div>
      <div className="day-numbers">
        {numberStyle.map((style, index) => (
          <DayNumber key={index} day={calendarDays[index]} style={style} />
        ))}
      </div>
    </>
  );
};

export default React.memo(Calendar);
