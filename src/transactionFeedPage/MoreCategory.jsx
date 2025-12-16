import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useSprings, useSpring, animated, easings } from "react-spring";
import { ScalableElement } from "../utils/tools";
import useClickOutside from "../hooks/useClickOutside";
import { useLongPress } from "use-long-press";
import { filter } from "framer-motion/client";

const MoreCategory = ({
  List,
  selectedCategory,
  setSelectedCategory,
  isLongPress,
  setIsLongPress,
}) => {
  const containerRef = useRef(null);
  useClickOutside(containerRef, () => setIsLongPress(false));

  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const characterCountsIni = useMemo(() => {
    return List.map((item) => Math.round(item[0].length * 5 + 70));
  }, [List]);
  const [characterCounts, setCharacterCounts] = useState(characterCountsIni);

  const cumulatedValuesIni = useMemo(() => {
    return characterCounts.reduce((acc, value) => {
      const lastValue = acc.length > 0 ? acc[acc.length - 1] : 0;
      acc.push(lastValue + value);
      return acc;
    }, []);
  }, [characterCounts]);

  useEffect(() => {
    setCharacterCounts(characterCountsIni);
  }, [characterCountsIni, cumulatedValuesIni, List, setSelectedCategory]);

  const handleClick = (item) => {
    if (isDragging) {
      setIsLongPress(false);
      setSelectedCategory(List[item]);
    }
  };

  const listSpringsOpen = useSprings(
    List.length,
    List.map((item) => ({
      backgroundColor:
        item[0] === selectedCategory[0] ? `var(--Bc-3)` : `var(--Ac-5)`,
    }))
  );

  const [enabled, setEnabled] = useState(true);
  const longPressTimeout = useRef(null);

  navigator.vibrate =
    navigator.vibrate ||
    navigator.webkitVibrate ||
    navigator.mozVibrate ||
    navigator.msVibrate;

  const startLongPress = useCallback((event) => {
    longPressTimeout.current = setTimeout(() => {
      if (navigator.vibrate) {
        navigator.vibrate(1000);
      }
      setIsLongPress(true);
    }, 500);
  }, []);

  const handleMove = useCallback(
    (event) => {
      if (isLongPress) {
      }
    },
    [isLongPress]
  );

  const longBind = useLongPress(enabled ? startLongPress : null, {
    onStart: (event) => {
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("touchmove", handleMove);
    },
  });

  const Apear = useSpring({
    from: {
      opacity: isLongPress ? 0 : 1,
    },
    to: {
      opacity: !isLongPress ? 0 : 1,
      filter: !isLongPress ? "blur(10px)" : "blur(0px)",
      position: "absolute",
      top: "-10%",
      height: "110%",
      width: "100%",
      zIndex: 100,
      // height: `calc(70% + ${listSprings.length * 15}px)`,
      overflow: "visible",
      background: "none",
      outline: "none",
      display: "flex",
      marginLeft: 10,
    },
    config: { duration: 1000, easing: easings.easeOutExpo },
  });
  const ApearP = useSpring({
    from: { opacity: isLongPress ? 0 : 1, top: isLongPress ? 50 : 25 },
    to: {
      opacity: !isLongPress ? 0 : 1,
      top: !isLongPress ? 50 : 25,
      position: "relative",
    },
  });
  const ApearItems = useSpring({
    from: {
      top: 150,
    },
    to: {
      position: "relative",
      top: 100,
      flexDirection: "column",
      alignItems: "flex-start",
      left: -108,
      background: "none",
      flexWrap: "wrap",
      width: "max-content",
      minHeight: 300,
    },
  });
  const Apearh2 = useSpring({
    marginBottom: 6,
  });

  return (
    <>
      <animated.li className="Add_Category" {...longBind()} style={Apear}>
        {/* <animated.p style={ApearP}>Select a category : </animated.p>{" "} */}
        <animated.div
          className="Add_Category_items"
          style={ApearItems}
          ref={containerRef}
        >
          {listSpringsOpen.map((animation, index) => (
            <ScalableElement
              style={{
                ...animation,
                ...Apearh2,
                width: `${characterCounts[index]}px`,
              }}
              as="h2"
              key={index}
              onMouseDown={() => handleMouseDown(index)}
              onClick={() => handleClick(index)}
            >
              {List[index][1]}
              {List[index][0]}
            </ScalableElement>
          ))}
        </animated.div>
      </animated.li>
    </>
  );
};

export default MoreCategory;
