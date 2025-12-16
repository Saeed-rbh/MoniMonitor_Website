import React, {
  useRef,
  useCallback,
  useMemo,
  useReducer,
  useState,
  useEffect,
} from "react";
import { useSpring, animated, easings } from "react-spring";
import useClickOutside from "../hooks/useClickOutside";
import {
  MdOutlineChevronLeft,
  MdOutlineChevronRight,
  MdKeyboardArrowDown,
  MdCheck,
} from "react-icons/md";
import { ScalableElement } from "../utils/tools";
import Calendar from "./Calendar";
import ScrollableList from "../components/ScrollableList";

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

const MoreDate = ({ selectedDate, setSelectedDate }) => {
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
        width: "calc(100% - 40px)",
        margin: "0 5px",
        zIndex: 100,
        overflow: "visible",
        background: "none",
        outline: "none",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        top: 135,

        config: { duration: 1000, easing: easings.easeOutExpo },
      }),
      []
    )
  );
  const selecterFilterStyle = useSpring({
    filter: moreSelectedDate ? "blur(5px)" : "blur(0px)",
    scale: moreSelectedDate ? 0.9 : 1,
    opacity: moreSelectedDate ? 0.9 : 1,
  });

  const handlePreviousMonth = useCallback(() => {
    dispatch({ type: "PREVIOUS_MONTH" });
  }, []);

  const handleNextMonth = useCallback(() => {
    dispatch({ type: "NEXT_MONTH" });
  }, []);

  const handleSetDay = useCallback(
    (day) => {
      dispatch({ type: "SET_DAY", payload: day });
      setSelectedDate((prev) => ({
        ...prev,
        year: state.year,
        month: state.month + 1,
        day,
      }));
    },
    [state.year, state.month, setSelectedDate]
  );

  const selectDate = useSpring({
    top: moreSelectedDate ? 135 : 150,
    left: 30,
    position: "absolute",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    zIndex: 100,
    background: "var(--Ac-4)",
    padding: "10px 7px",
    borderRadius: "20px",
    opacity: moreSelectedDate ? 1 : 0,
  });

  const selectMonth = useSpring({
    opacity: 1,
    position: "relative",

    margin: "0 3px",
    zIndex: 100,
    overflow: "visible",

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

    outline: "none",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "column",
    color: "var(--Bc-1)",
    background: "var(--Ec-2)",
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
    background: "var(--Bc-3)",
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
    <>
      <animated.li className="MoreDateTime" style={{ ...Apear }}>
        <div className="Calendar_header">
          <ScalableElement
            as="h1"
            onClick={() => !moreSelectedDate && setMoreSelectedDate(true)}
          >
            <span>{monthNames[state.month]}</span> {state.year}{" "}
            <MdKeyboardArrowDown />
          </ScalableElement>
          <ScalableElement as="div" style={{ display: "flex" }}>
            <MdOutlineChevronLeft onClick={handlePreviousMonth} />
          </ScalableElement>
          <ScalableElement as="div" style={{ display: "flex" }}>
            <MdOutlineChevronRight onClick={handleNextMonth} />
          </ScalableElement>
        </div>
        <animated.div style={selecterFilterStyle} className="calendar">
          <Calendar
            month={state.month}
            year={state.year}
            selectedDay={state.day}
            setSelectedDay={handleSetDay}
            setSelectedDate={setSelectedDate}
          />
        </animated.div>
      </animated.li>
      {moreSelectedDate && (
        <>
          <animated.div style={selectDate} ref={calendarRef}>
            <animated.div style={selectMonth}>
              <ScrollableList
                items={monthNames}
                item={monthNames[state.month]}
                onSelect={(month) => handleSetMonth(month)}
                onConfirm={onConfirm}
              />
            </animated.div>
            <animated.div style={selectYear}>
              <ScrollableList
                items={years}
                item={state.year}
                onSelect={(year) => handleSetYear(year)}
                onConfirm={onConfirm}
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
        </>
      )}
    </>
  );
};

export default MoreDate;
