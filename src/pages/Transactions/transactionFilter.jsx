import React, { useState, useRef, useEffect, useMemo } from "react";
import { useSprings, animated, useSpring } from "@react-spring/web";
import { ScalableElement } from "../../utils/tools";
import { useDrag } from "@use-gesture/react";

const monthsFullNames = {
  Jan: "January",
  Feb: "February",
  Mar: "March",
  Apr: "April",
  May: "May",
  Jun: "June",
  Jul: "July",
  Aug: "August",
  Sep: "September",
  Oct: "October",
  Nov: "November",
  Dec: "December",
};

/**
 * Dynamically extracts all distinct calendar weeks containing transactions
 */
export const getWeeksFromTransactions = (transactions = []) => {
  if (!transactions || transactions.length === 0) return [];

  const weekMap = new Map();

  transactions.forEach((tx) => {
    if (!tx.Timestamp) return;
    const date = new Date(tx.Timestamp);
    if (Number.isNaN(date.getTime())) return;

    // Calculate Monday of the week (Monday = 1, Sunday = 0 -> 7)
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const startStr = monday.toISOString().slice(0, 10);
    const endStr = sunday.toISOString().slice(0, 10);
    const key = `week:${startStr}:${endStr}`;

    if (!weekMap.has(key)) {
      const startMonth = monday.toLocaleString("en-US", { month: "short" });
      const endMonth = sunday.toLocaleString("en-US", { month: "short" });
      const startDay = monday.getDate();
      const endDay = sunday.getDate();

      const label =
        startMonth === endMonth
          ? `${startMonth} ${startDay}–${endDay}`
          : `${startMonth} ${startDay} – ${endMonth} ${endDay}`;

      weekMap.set(key, { key, label, startTime: monday.getTime() });
    }
  });

  return Array.from(weekMap.values()).sort((a, b) => b.startTime - a.startTime);
};

/**
 * Extracts past available months from dataAvailability
 */
export const getAvailableMonths = (dataAvailability, whichMonth) => {
  if (!dataAvailability) return [];
  const list = [];

  const entries = Array.isArray(dataAvailability)
    ? dataAvailability
    : Object.entries(dataAvailability);

  entries.forEach(([year, monthsObj]) => {
    if (!monthsObj || typeof monthsObj !== "object") return;
    const months = Array.isArray(monthsObj) ? monthsObj[1] : monthsObj;
    if (!months || typeof months !== "object") return;

    Object.entries(months)
      .reverse()
      .forEach(([monthName, info]) => {
        const isAvailable = Array.isArray(info) ? info[0] : Boolean(info);
        const monthIndex = Array.isArray(info) ? info[1] : 0;
        if (isAvailable && monthIndex !== whichMonth) {
          list.push({
            key: `month:${monthIndex}`,
            label: monthsFullNames[monthName] || monthName,
            monthIndex,
          });
        }
      });
  });

  return list;
};

const TransactionFilter = ({
  sortby,
  setSortby,
  loaded,
  isMoreClicked,
  transactions = [],
  dataAvailability = null,
  setWhichMonth = null,
  whichMonth = 0,
  onManageAccounts = null,
}) => {
  const sortItems = useMemo(() => {
    const items = [
      { key: "All", label: "All", type: "preset" },
      { key: "Today", label: "Today", type: "preset" },
      { key: "This Week", label: "This Week", type: "preset" },
    ];

    // Add dynamic week ranges from current transactions
    const weeks = getWeeksFromTransactions(transactions);
    weeks.forEach((w) => {
      items.push({ key: w.key, label: w.label, type: "week" });
    });

    // Add historical available months
    const months = getAvailableMonths(dataAvailability, whichMonth);
    months.forEach((m) => {
      items.push({ key: m.key, label: m.label, type: "month", monthIndex: m.monthIndex });
    });

    if (onManageAccounts) {
      return [{ key: "Accounts", label: "Accounts", type: "action" }, ...items];
    }

    return items;
  }, [transactions, dataAvailability, whichMonth, onManageAccounts]);

  const [scrollWidth, setScrollWidth] = useState(0);
  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [currentX, setCurrentX] = useState(0);
  const isScrolling = useRef(false);
  const widthRef = useRef(null);
  const ParWidthRef = useRef(null);

  useEffect(() => {
    const parWidth = ParWidthRef.current ? ParWidthRef.current.offsetWidth : 0;
    const contentWidth = widthRef.current ? widthRef.current.scrollWidth : 0;
    setScrollWidth(Math.max(0, contentWidth - parWidth + 30));
  }, [sortItems]);

  const bind = useDrag(({ down, movement: [mx], memo = currentX, cancel }) => {
    if (scrollWidth <= 0) cancel();

    let newX = memo + mx;
    if (newX > 0) newX = 0;
    if (newX < -scrollWidth) newX = -scrollWidth;

    if (down) {
      if (Math.abs(mx) > 5) {
        isScrolling.current = true;
      }
      api.start({ x: newX });
    } else {
      setTimeout(() => {
        isScrolling.current = false;
      }, 100);
      setCurrentX(newX);
    }
    return memo;
  });

  const [springs] = useSprings(
    sortItems.length,
    (index) => {
      const item = sortItems[index];
      const isSelected = sortby === item.key;

      return {
        filter: isSelected ? "grayscale(0)" : "grayscale(1)",
        color: isSelected ? "var(--Bc-1)" : "var(--Ac-1)",
        fontWeight: isSelected ? "600" : "400",
        background: isSelected
          ? "radial-gradient(circle at 30% -20%, var(--Bc-3) -100%, var(--Ec-4) 65%)"
          : "var(--Ac-5)",
        outline: isSelected ? "1.5px solid var(--Bc-1)" : "1px solid var(--Ac-3)",
      };
    },
    [sortby, sortItems]
  );

  const handleClick = (index) => {
    if (!isScrolling.current) {
      const item = sortItems[index];
      if (item.type === "action" && onManageAccounts) {
        onManageAccounts();
        return;
      }
      if (item.type === "month") {
        if (setWhichMonth) {
          setWhichMonth(item.monthIndex);
          setSortby("All");
        }
        return;
      }
      setSortby(item.key);
    }
  };

  return (
    <>
      {loaded && (
        <animated.div
          className="TransactionList_Menu"
          {...bind()}
          ref={ParWidthRef}
        >
          <animated.div
            ref={widthRef}
            style={{
              height: "40px",
              display: "flex",
              alignItems: "center",
              transform: x.to((val) => `translateX(${val}px)`),
            }}
          >
            {springs.map((props, index) => (
              <ScalableElement
                as="h1"
                key={sortItems[index].key}
                style={{
                  ...props,
                }}
                onClick={() => handleClick(index)}
              >
                {sortItems[index].label}
              </ScalableElement>
            ))}
          </animated.div>
        </animated.div>
      )}
    </>
  );
};

export default TransactionFilter;
