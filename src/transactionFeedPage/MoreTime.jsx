import React, {
  useRef,
  useCallback,
  useMemo,
  useReducer,
  useState,
  useEffect,
} from "react";
import { useSpring, animated, easings } from "react-spring";
import useClickOutside from "../Tools/useClickOutside";
import {
  MdOutlineChevronLeft,
  MdOutlineChevronRight,
  MdKeyboardArrowDown,
  MdCheck,
} from "react-icons/md";
import { ScalableElement } from "../Tools/tools";
import Calendar from "./Calendar";
import ScrollableList from "../Tools/scrollableList";

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

const generateYearsArray = (currentYear, n, m) => {
  const yearsArray = [];

  for (let i = currentYear - n; i <= currentYear + m; i++) {
    yearsArray.push(i);
  }

  return yearsArray;
};

const initialState = (selectedDate) => ({
  year: parseInt(selectedDate.year),
  month: selectedDate.month - 1, // Adjust for zero-indexed month
  day: selectedDate.day,
});

const dateReducer = (state, action) => {
  switch (action.type) {
    case "PREVIOUS_MONTH":
      return state.month === 0
        ? { ...state, month: 11, year: state.year - 1, day: null }
        : { ...state, month: state.month - 1, day: null };
    case "NEXT_MONTH":
      return state.month === 11
        ? { ...state, month: 0, year: state.year + 1, day: null }
        : { ...state, month: state.month + 1, day: null };
    case "SET_DAY":
      return { ...state, day: action.payload };
    case "SET_YEAR":
      return { ...state, year: action.payload };
    case "SET_MONTH":
      return { ...state, month: action.payload };
    default:
      return state;
  }
};

const MoreTime = ({ selectedDate, setSelectedDate }) => {
  const [state, dispatch] = useReducer(dateReducer, initialState(selectedDate));

  const [moreSelectedDate, setMoreSelectedDate] = useState(false);
  const calendarRef = useRef(null);
  useClickOutside(calendarRef, () => setMoreSelectedDate(false));

  const years = generateYearsArray(state.year, 5, 5);

  useEffect(() => {
    // Update local state when selectedDate prop changes
    dispatch({ type: "SET_YEAR", payload: parseInt(selectedDate.year) });
    dispatch({ type: "SET_MONTH", payload: selectedDate.month - 1 });
    dispatch({ type: "SET_DAY", payload: selectedDate.day });
  }, [selectedDate]);

  const Apear = useSpring(
    useMemo(
      () => ({
        opacity: 1,
        position: "absolute",
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
        top: 100,
      }),
      []
    )
  );

  const selectDate = useSpring({
    top: 370,
    left: 30,
    position: "absolute",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    zIndex: 100,
    // background: "var(--Ac-4)",
    padding: "10px 7px",
    borderRadius: "20px",
    opacity: 1,
    height: 60,
    overflow: "hidden",
  });

  const selectMonth = useSpring({
    opacity: 1,
    position: "relative",
    width: "max-content",
    margin: "0 3px",
    zIndex: 100,
    overflow: "visible",
    background: "none",
    outline: "none",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "column",
    color: "var(--Ac-1)",
    background: "var(--Ec-2)",
    width: "100%",
    height: "100%",
    borderRadius: "15px",
  });

  const selectYear = useSpring({
    opacity: 1,
    position: "relative",
    margin: "0 3px",
    zIndex: 100,
    overflow: "visible",
    background: "none",
    outline: "none",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "column",
    color: "var(--Bc-1)",
    // background: "var(--Ec-2)",
    width: "100%",
    height: "100%",
    borderRadius: "10px",
  });
  const selectConfirm = useSpring({
    width: "55px",
    height: "55px",
    position: "absolute",
    bottom: 0,
    right: -63,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: "50%",
    // background: "var(--Bc-3)",
    color: "var(--Ec-1)",
    fontSize: "1.8rem",
    cursor: "pointer",
    border: "2px solid var(--Bc-4)",
    opacity: moreSelectedDate ? 1 : 0,
    scale: moreSelectedDate ? 1 : 0,
  });

  const handleSetMonth = useCallback(
    (monthIndex) => {
      dispatch({ type: "SET_MONTH", payload: monthIndex });

      // Update the selected date with the new month value.
      setSelectedDate((prev) => ({
        ...prev,
        month: monthIndex + 1, // Convert to 1-based month
      }));
    },
    [setSelectedDate]
  );

  const handleSetYear = useCallback(
    (year) => {
      dispatch({ type: "SET_YEAR", payload: years[year] });

      // Update the selected date with the new year value.
      setSelectedDate((prev) => ({
        ...prev,
        year: years[year],
      }));
    },
    [setSelectedDate]
  );

  const [onConfirm, setOnConfirm] = useState(false);
  useEffect(() => {
    if (moreSelectedDate) {
      setOnConfirm(false);
    }
  }, [moreSelectedDate]);

  const handleClickConfirm = useCallback(async () => {
    setOnConfirm(true);

    // Wait until React completes the state update (conceptual, since state updates aren't directly awaitable).
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Proceed after `onConfirm` is set to true.
    setMoreSelectedDate(false);
  }, []);

  return (
    <animated.div style={selectDate} ref={calendarRef}>
      <animated.div style={selectMonth}>
        <ScrollableList
          items={monthNames}
          item={monthNames[state.month]}
          onSelect={(month) => handleSetMonth(month)}
          onConfirm={onConfirm}
          margin={0}
          fontSize={"0.7rem"}
        />
      </animated.div>
      <animated.div style={selectYear}>
        <ScrollableList
          items={years}
          item={state.year}
          onSelect={(year) => handleSetYear(year)}
          onConfirm={onConfirm}
          margin={0}
          fontSize={"0.7rem"}
        />
      </animated.div>
      <ScalableElement
        as="div"
        style={selectConfirm}
        onClick={handleClickConfirm}
      >
        <MdCheck />
      </ScalableElement>
    </animated.div>
  );
};

export default MoreTime;
