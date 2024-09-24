import React, { useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { animated, useSpring } from "react-spring";
import { useDrag } from "@use-gesture/react";
import useClickOutside from "../Tools/useClickOutside";
import { IoClose } from "react-icons/io5";

const ChooseMonth = ({ isDateClicked, setIsDateClicked }) => {
  const containerRef = useRef(null);
  useClickOutside(containerRef, () => setIsDateClicked(false));
  const MainStyle = {
    position: "absolute",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "var(--Ac-4)",
    color: "var(--Ac-1)",
    // opacity: 0.7,
    // border: "2px solid var(--Ac-4)",
    borderRadius: "50px",
    cursor: "pointer",
    fontSize: "0.65rem",
    width: "max-content",
    height: "35px",
    overflow: "visible",
    right: 60,
    top: 8,
    padding: "3px 1px",
    cursor: "pointer",
    zIndex: 100,
  };
  const SVGStyle = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "35px",
    height: "35px",
    fontSize: "1rem",
    borderRadius: "50px",
    backgroundColor: "var(--Ec-3)",
    border: "3px solid var(--Bc-4)",
    color: "var(--Bc-1)",
    transform: "rotate(90deg)",
  };
  const MonthStyle = {
    width: "75px",
    height: "35px",
    borderRadius: "50px",
    margin: "0 0px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "var(--Ec-3)",
    border: "3px solid var(--Ac-4)",
    fontWeight: "400",
  };
  const MonthSpanStyle = {
    marginLeft: "5px",
    fontWeight: "200",
  };
  const OpenStyle = {
    position: "absolute",
    top: "50px",
    right: 0,
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    width: "260px",
    height: "260px",
    borderRadius: "35px",
    backgroundColor: "var(--Ec-2)",
    border: "3px solid var(--Ac-4)",
    color: "var(--Bc-1)",
  };
  const OpenStyleAnim = useSpring({
    opacity: isDateClicked ? 1 : 0,
    scale: isDateClicked ? 1 : 0.9,
    top: isDateClicked ? 50 : 30,
    right: isDateClicked ? 0 : -10,
  });
  const openYearStyle = {
    position: "absolute",
    top: "15px",
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    width: "calc(100% - 66px)",
    overflow: "auto",
    left: "33px",
    boxSizing: "border-box",
    scrollbarWidth: "none", // Firefox
    msOverflowStyle: "none", // IE 10+
  };

  const yearStyle = {
    minWidth: "60px",
    height: "35px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "var(--Ac-4)",
    opacity: 0.9,
    color: "var(--Ac-1)",
    border: "2px solid var(--Ac-4)",
    borderRadius: "50px",
    margin: "0 1px",
    cursor: "pointer",
    fontSize: "0.65rem",
  };

  const YearSVGStyle = {
    position: "absolute",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "35px",
    height: "35px",
    fontSize: "1rem",
    borderRadius: "50px",
    // backgroundColor: "var(--Ac-4)",
    color: "var(--Bc-1)",
    top: 15,
  };
  const YearSVGLStyle = {
    right: 0,
  };
  const YearSVGRStyle = { left: 0 };

  const openMonthStyle = {
    position: "absolute",
    top: "60px",
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    width: "calc(100% - 10px)",
    padding: "5px",
    overflow: "hidden",
    left: "5px",
    boxSizing: "border-box",
  };
  const monthStyle = {
    minWidth: "50px",
    height: "40px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    // backgroundColor: "var(--Ac-4)",
    opacity: 0.7,
    color: "var(--Ac-1)",
    // border: "2px solid var(--Ac-4)",
    borderRadius: "20px",
    margin: "3px",
    cursor: "pointer",
    fontSize: "0.65rem",
  };
  const OpenAllStyle = {
    position: "fixed",
    top: 10,
    right: 0,
    width: "100%",
    height: "100%",
    opacity: 0.5,
    borderRadius: "50px",
    zIndex: -1,
    config: { duration: 10 },
  };
  const OpenAllStyleAmin = useSpring({
    display: isDateClicked ? "block" : "none",
  });

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const startYear = 2020;
  const currentYear = new Date().getFullYear();
  const yearDates = Array.from(
    { length: currentYear - startYear + 1 },
    (_, index) => startYear + index
  );

  const toggleOpen = () => setIsDateClicked(!isDateClicked);

  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [currentX, setCurrentX] = useState(0);

  // Define the width of each item and dynamically compute the max scroll value
  const itemWidth = 33; // Adjust as necessary
  const maxScroll = (yearDates.length - 1) * itemWidth; // Max positive scroll based on the number of years

  // Helper function to snap to nearest element, with proper boundary handling
  const snapToElement = (value) => {
    if (value < itemWidth / 2) return 0; // Snap to start if close to 0
    if (value > maxScroll - itemWidth / 2) return maxScroll; // Snap to end if close to max scroll
    return Math.round(value / itemWidth) * itemWidth; // Otherwise snap to nearest element
  };

  // Handle dragging interaction
  const bind = useDrag(({ down, movement: [mx], cancel }) => {
    if (yearDates.length < 5) cancel(); // Disable dragging if there are less than 5 years

    const newX = currentX + mx;

    // Enforce boundaries while dragging
    if (newX < 0) return setCurrentX(0); // Prevent scrolling past the left (min 0)
    if (newX > maxScroll) return setCurrentX(maxScroll); // Prevent scrolling past the right (max scroll)

    // When dragging stops, snap to the nearest element
    if (!down) {
      const snappedX = snapToElement(newX);
      setCurrentX(snappedX);
      api.start({ x: snappedX });
    } else {
      // Animate the position while dragging
      api.start({ x: newX });
    }
  });

  // Handle clicking left (scroll right)
  const handleClickLeft = () => {
    const newX = snapToElement(currentX + itemWidth * 2); // Scroll right by two item widths

    // Enforce the boundary
    if (newX > maxScroll) return setCurrentX(maxScroll);

    setCurrentX(newX);
    api.start({ x: newX });
  };

  // Handle clicking right (scroll left)
  const handleClickRight = () => {
    const newX = snapToElement(currentX - itemWidth * 2); // Scroll left by two item widths

    // Enforce the boundary
    if (newX < 0) return setCurrentX(0);

    setCurrentX(newX);
    api.start({ x: newX });
  };

  const [selectedYear, setSelectedYear] = useState(2023);
  const handleYearClick = (year) => {
    setSelectedYear(year);
  };
  const [selectedMonth, setSelectedMonth] = useState("Feb");
  const handleMonthClick = (month) => {
    setSelectedMonth(month);
    toggleOpen();
  };

  return (
    <>
      <animated.div
        style={{ ...OpenAllStyle, ...OpenAllStyleAmin }}
      ></animated.div>
      <div style={MainStyle} ref={containerRef}>
        <p style={MonthStyle} onClick={toggleOpen}>
          {selectedMonth} <span style={MonthSpanStyle}>{selectedYear}</span>
        </p>
        <div style={SVGStyle} onClick={toggleOpen}>
          {isDateClicked ? <IoClose /> : <FiChevronRight />}
        </div>
        <animated.div style={{ ...OpenStyle, ...OpenStyleAnim }}>
          <div
            style={{ ...YearSVGStyle, ...YearSVGRStyle }}
            onClick={handleClickLeft}
          >
            <FiChevronLeft />
          </div>
          <animated.div
            style={{
              ...openYearStyle,
            }}
            {...bind()}
          >
            {yearDates.map((year, index) => (
              <animated.p
                key={index}
                style={{
                  ...yearStyle,
                  opacity: year === selectedYear ? 1 : 0.7,

                  transform: x.to((x) => `translate3d(${x}px,0,0)`),
                  backgroundColor:
                    year === selectedYear ? "var(--Bc-4)" : "var(--Ac-4)",
                }}
                onClick={() => handleYearClick(year)}
              >
                {year}
              </animated.p>
            ))}
          </animated.div>
          <div style={openMonthStyle}>
            {monthNames.map((month, index) => (
              <p
                key={index}
                style={{
                  ...monthStyle,
                  backgroundColor:
                    month === selectedMonth ? "var(--Bc-3)" : "var(--Ec-4)",
                }}
                onClick={() => handleMonthClick(month)}
              >
                {month}
              </p>
            ))}
          </div>
          <div
            style={{ ...YearSVGStyle, ...YearSVGLStyle }}
            onClick={handleClickRight}
          >
            <FiChevronRight />
          </div>
        </animated.div>
      </div>
    </>
  );
};

export default ChooseMonth;
