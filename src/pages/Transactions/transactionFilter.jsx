import React, { useState, useRef, useEffect } from "react";
import { useSprings, animated, useSpring } from "@react-spring/web";
import { ScalableElement } from "../../utils/tools";
import { useDrag } from "@use-gesture/react";

const TransactionFilter = ({
  sortby,
  setSortby,
  loaded,
  isMoreClicked,
  availabilityMap,
  onManageAccounts,
}) => {
  const sortItems = React.useMemo(() => {
    let items;
    // If in a specific Category Context (Income, Expense, Save&Invest), show only Time filters
    if (["Income", "Expense", "Save&Invest"].includes(isMoreClicked)) {
      items = ["All", "daily", "monthly", "Today"];
    } else {
      // If in Balance (Main) Context, show Categories + Time filters
      items = ["All", "Income", "Expense", "Save&Invest", "daily", "monthly", "Today"];
    }
    return onManageAccounts ? ["Accounts", ...items] : items;
  }, [isMoreClicked, onManageAccounts]);

  const [scrollWidth, setScrollWidth] = useState(0);
  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [currentX, setCurrentX] = useState(0);
  const isScrolling = useRef(false); // Use ref for synchronous access
  const widthRef = useRef(null);
  const ParWidthRef = useRef(null);

  useEffect(() => {
    const parWidth = ParWidthRef.current ? ParWidthRef.current.offsetWidth : 0;
    setScrollWidth(
      widthRef.current ? widthRef.current.offsetWidth - parWidth + 20 : 0
    );
  }, [widthRef.current]);

  const bind = useDrag(({ down, movement: [mx], memo = currentX, cancel }) => {
    if (sortItems.length < 5) cancel();

    let newX = memo + mx;
    if (newX > 0) return setCurrentX(0);
    if (newX < -scrollWidth) return setCurrentX(-scrollWidth);

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
      // Default to true if availabilityMap is missing or item not in map (e.g., legacy behavior)
      const isAvailable =
        !availabilityMap ||
        availabilityMap[item] === undefined ||
        availabilityMap[item];

      return {
        filter: sortby === item ? "grayscale(0)" : "grayscale(1)",
        color: sortby === item ? "var(--Bc-1)" : "var(--Ac-1)",
        fontWeight: sortby === item ? "600" : "200",
        outline:
          sortby === item
            ? "1px solid var(--Bc-3)"
            : "1px solid var(--Bc-3)",
        opacity: isAvailable ? 1 : 0.3,
        pointerEvents: isAvailable ? "auto" : "none",
      };
    },
    [sortby, sortItems, availabilityMap]
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
              transform: x.to((x) => `translateX(${x}px)`),
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
