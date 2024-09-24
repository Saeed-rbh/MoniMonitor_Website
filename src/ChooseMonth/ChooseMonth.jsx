import React, { useRef, useState, useEffect } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { animated, useSpring } from "react-spring";
import { useDrag } from "@use-gesture/react";
import useClickOutside from "../Tools/useClickOutside";
import { IoClose } from "react-icons/io5";

const MainStyle = {
  position: "absolute",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: "var(--Ac-4)",
  color: "var(--Ac-1)",
  borderRadius: "50px",
  cursor: "pointer",
  fontSize: "0.65rem",
  width: "max-content",
  height: "35px",
  overflow: "visible",
  right: 60,
  top: 8,
  padding: "3px 1px",
  zIndex: 100,
  transition: "background-color 0.5s ease",
};

// const availabilityData = [
//   ["2024", { Aug: [true, 1], Sep: [true, 0] }],
//   ["2022", { Jan: [true, 0], Feb: [true, 1], Mar: [true, 1], Apr: [true, 1] }],
//   ["2021", { Jan: [true, 0], Feb: [true, 1], Mar: [true, 1], Apr: [true, 1] }],
//   ["2020", { Jan: [true, 0], Feb: [true, 1], Mar: [true, 1], Apr: [true, 1] }],
//   // Add more years and months as needed
// ];

const ChooseMonth = ({ isDateClicked, setIsDateClicked, availabilityData }) => {
  const containerRef = useRef(null);
  useClickOutside(containerRef, () => setIsDateClicked(false));

  // Extract available years and months from availabilityData
  const availableYears = availabilityData.map((yearData) =>
    parseInt(yearData[0])
  );
  const availableMonths = {};

  availabilityData.forEach((yearData) => {
    const months = yearData[1];
    Object.keys(months).forEach((month) => {
      if (!availableMonths[month]) {
        availableMonths[month] = true;
      }
    });
  });

  // Initialize selected month and year
  const currentYear = new Date().getFullYear();
  const currentMonthIndex = new Date().getMonth(); // 0 = Jan, 1 = Feb, ..., 11 = Dec
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

  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState("");

  useEffect(() => {
    // Find the nearest available month for the current year
    const yearData = availabilityData.find(
      (data) => data[0] === String(selectedYear)
    );
    if (yearData) {
      const months = yearData[1];
      const availableMonthKeys = Object.keys(months);
      const nearestMonth = availableMonthKeys.find(
        (_, index) => index >= currentMonthIndex
      );
      setSelectedMonth(nearestMonth || availableMonthKeys[0] || ""); // Fallback to the first available month
    }
  }, [selectedYear]);

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
    transition: "background-color 0.5s ease",
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
    transition: "background-color 0.5s ease",
  };

  const MonthSpanStyle = {
    marginLeft: "5px",
    fontWeight: "200",
    transition: "background-color 0.5s ease",
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
    transition: "background-color 0.5s ease",
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
    transition: "background-color 0.5s ease",
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
    transition: "background-color 0.5s ease",
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
    color: "var(--Bc-1)",
    top: 15,
    transition: "background-color 0.5s ease",
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
    transition: "background-color 0.5s ease",
  };

  const monthStyle = {
    minWidth: "50px",
    height: "40px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    opacity: 0.7,
    color: "var(--Ac-1)",
    borderRadius: "20px",
    margin: "3px",
    cursor: "pointer",
    fontSize: "0.65rem",
    transition: "background-color 0.5s ease",
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

  const startYear = 2020;
  const yearDates = Array.from(
    { length: new Date().getFullYear() - startYear + 1 },
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

  const handleYearClick = (year) => {
    setSelectedYear(year); // Update selected year
  };

  const handleMonthClick = (month) => {
    setSelectedMonth(month); // Update selected month
    setIsDateClicked(false); // Close
  };

  return (
    <>
      {isDateClicked && (
        <animated.div
          style={{ ...OpenAllStyle, ...OpenAllStyleAmin }}
        ></animated.div>
      )}
      <div style={MainStyle} ref={containerRef}>
        <p style={MonthStyle} onClick={toggleOpen}>
          {selectedMonth} <span style={MonthSpanStyle}>{selectedYear}</span>
        </p>
        <div style={SVGStyle} onClick={toggleOpen}>
          {isDateClicked ? <IoClose /> : <FiChevronRight />}
        </div>
        <animated.div style={{ ...OpenStyle, ...OpenStyleAnim }}>
          {/* Year Navigation */}
          <div
            style={{ ...YearSVGStyle, ...YearSVGRStyle }}
            onClick={handleClickLeft}
          >
            <FiChevronLeft />
          </div>
          <animated.div style={{ ...openYearStyle }} {...bind()}>
            {yearDates.map((year, index) => (
              <animated.p
                key={index}
                style={{
                  ...yearStyle,
                  opacity: availableYears.includes(year) ? 1 : 0.5,
                  transform: x.to((x) => `translate3d(${x}px,0,0)`),
                  cursor: availableYears.includes(year) ? "pointer" : "default",
                  backgroundColor:
                    parseInt(selectedYear) === parseInt(year)
                      ? "var(--Bc-4)"
                      : availableYears.includes(year)
                      ? "var(--Ac-4)"
                      : "var(--Ac-4)",
                }}
                onClick={() =>
                  availableYears.includes(year) && handleYearClick(year)
                } // Prevent click on unavailable years
              >
                {year}
              </animated.p>
            ))}
          </animated.div>

          {/* Month Navigation */}
          <div style={openMonthStyle}>
            {monthNames.map((month, index) => {
              const isDisabled =
                (selectedYear === currentYear && index > currentMonthIndex) ||
                !availableMonths[month]; // Disable if not available or future month in current year

              return (
                <p
                  key={index}
                  style={{
                    ...monthStyle,
                    backgroundColor:
                      month === selectedMonth ? "var(--Bc-3)" : "var(--Ec-4)",
                    cursor: isDisabled ? "default" : "pointer",
                    opacity: isDisabled ? 0.5 : 1, // Visually indicate disabled months
                  }}
                  onClick={() => !isDisabled && handleMonthClick(month)}
                >
                  {month}
                </p>
              );
            })}
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
