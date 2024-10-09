import React, { useState, useRef, useEffect } from "react";
import { useSprings, animated, useSpring } from "react-spring";
import { ScalableElement } from "../Tools/tools";
import { useDrag } from "@use-gesture/react";

const TransactionFilter = ({ sortby, setSortby, loaded }) => {
  const sortItems = ["All", "daily", "monthly", "Income", "Expense", "Today"];
  const [scrollWidth, setScrollWidth] = useState(0);
  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [currentX, setCurrentX] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
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
      setIsScrolling(true); // Set scrolling state to true
      api.start({ x: newX });
    } else {
      setIsScrolling(false); // Reset scrolling state
      setCurrentX(newX);
    }
    return memo;
  });

  const [springs] = useSprings(
    sortItems.length,
    (index) => ({
      filter: sortby === sortItems[index] ? "grayscale(0)" : "grayscale(1)",
      color: sortby === sortItems[index] ? "var(--Bc-1)" : "var(--Ac-1)",
      fontWeight: sortby === sortItems[index] ? "600" : "200",
      outline:
        sortby === sortItems[index]
          ? "1px solid var(--Bc-3)"
          : "1px solid var(--Bc-3)",
    }),
    [sortby]
  );

  const handleClick = (index) => {
    if (!isScrolling) {
      setSortby(sortItems[index]);
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
