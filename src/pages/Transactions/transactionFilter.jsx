import React, { useState, useRef, useEffect, useMemo } from "react";
import { useSprings, animated, useSpring } from "@react-spring/web";
import { ScalableElement } from "../../utils/tools";
import { useDrag } from "@use-gesture/react";

const TransactionFilter = ({
  sortby,
  setSortby,
  loaded,
  isMoreClicked,
  onManageAccounts = null,
}) => {
  const sortItems = useMemo(() => {
    let items;
    if (["Income", "Expense", "Save&Invest", "Internal"].includes(isMoreClicked)) {
      items = ["All", "Daily", "Monthly"];
    } else {
      items = ["All", "Income", "Expense", "Save&Invest", "Internal"];
    }
    return onManageAccounts ? ["Accounts", ...items] : items;
  }, [isMoreClicked, onManageAccounts]);

  const [scrollWidth, setScrollWidth] = useState(0);
  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [currentX, setCurrentX] = useState(0);
  const isScrolling = useRef(false);
  const widthRef = useRef(null);
  const ParWidthRef = useRef(null);

  useEffect(() => {
    const parWidth = ParWidthRef.current ? ParWidthRef.current.offsetWidth : 0;
    const contentWidth = widthRef.current ? widthRef.current.scrollWidth : 0;
    setScrollWidth(Math.max(0, contentWidth - parWidth + 20));
  }, [sortItems]);

  const bind = useDrag(({ down, movement: [mx], memo = currentX, cancel }) => {
    if (sortItems.length < 4 || scrollWidth <= 0) cancel();

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
      const isSelected = sortby === item;

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
      if (item === "Accounts" && onManageAccounts) {
        onManageAccounts();
        return;
      }
      setSortby(item);
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
                key={sortItems[index]}
                style={{
                  ...props,
                }}
                onClick={() => handleClick(index)}
              >
                {sortItems[index]}
              </ScalableElement>
            ))}
          </animated.div>
        </animated.div>
      )}
    </>
  );
};

export default TransactionFilter;
