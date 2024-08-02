import React from "react";
import { useSpring, animated } from "@react-spring/web";
import { FaCheck } from "react-icons/fa";
import { FaXmark } from "react-icons/fa6";
const monthMapping = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};
function ChooseTransactionMonth({
  isClicked,
  setIsClicked,
  dataAvailability,
  setWhichMonth,
  whichMonth,
}) {
  const clickAction = useSpring({});

  const clickAction2 = useSpring({});

  const handleMonthClick = (month) => {
    setWhichMonth(month);
    setIsClicked(false);
  };

  return (
    <animated.div className="TransactionList_MonthlyFooter" style={clickAction}>
      <div className="TransactionList_MonthlyNames">
        <h3>Timeline</h3>
        {Object.entries(dataAvailability).map(([year, monthsData]) => (
          <div key={year} className="TransactionList_MonthlyYear">
            <animated.h1>
              {monthsData[0]}
              <span></span>
            </animated.h1>

            {Object.entries(monthsData[1])
              .reverse()
              .map(([month, value], index) => (
                <animated.p
                  style={{
                    ...clickAction2,
                    cursor: value[0] ? "pointer" : "unset",
                    opacity: value[0] ? 1 : 0.7,
                    background:
                      whichMonth === value[1]
                        ? "var(--Bc-3)"
                        : value[0]
                        ? "var(--Ec-2)"
                        : "var(--Ac-4)",
                  }}
                  onClick={() => value[0] && handleMonthClick(value[1])}
                  key={index}
                >
                  <span>{monthMapping[month]}</span>
                  <span>{month}</span>
                  <span
                    style={{
                      background:
                        whichMonth === value[1]
                          ? "var(--Bc-1)"
                          : value[0]
                          ? "var(--Fc-1)"
                          : "var(--Gc-1)",

                      fontSize: value[0] ? "0.5rem" : "0.7rem",
                    }}
                  >
                    {value[0] ? <FaCheck /> : <FaXmark />}
                  </span>
                </animated.p>
              ))}
          </div>
        ))}
      </div>
    </animated.div>
  );
}

export default ChooseTransactionMonth;
