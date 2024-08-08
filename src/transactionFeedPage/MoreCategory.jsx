import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useSprings, useSpring, animated, easings } from "react-spring";
import { ScalableElement } from "../Tools/tools";
import { useLongPress } from "use-long-press";

const MoreCategory = ({
  List,
  selectedCategory,
  setSelectedCategory,
  isLongPress,
  setIsLongPress,
}) => {
  const containerRef = useRef(null);

  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const [draggedX, setDraggedX] = useState(0);

  const characterCountsIni = useMemo(() => {
    return List.map((item) => Math.round(item[0].length * 6 + 65));
  }, [List]);
  const [characterCounts, setCharacterCounts] = useState(characterCountsIni);

  const cumulatedValuesIni = useMemo(() => {
    return characterCounts.reduce((acc, value) => {
      const lastValue = acc.length > 0 ? acc[acc.length - 1] : 0;
      acc.push(lastValue + value);
      return acc;
    }, []);
  }, [characterCounts]);
  const [cumulatedValues, setCumulatedValues] = useState(cumulatedValuesIni);

  useEffect(() => {
    setCharacterCounts(characterCountsIni);
    setCumulatedValues(cumulatedValuesIni);
  }, [characterCountsIni, cumulatedValuesIni, List, setSelectedCategory]);

  const handleClick = (item) => {
    if (isDragging) {
      setIsLongPress(false);
      setSelectedCategory(List[item]);
      // item !== 0 &&
      //   item !== cumulatedValues.length - 1 &&
      //   setDraggedX(cumulatedValues[item - 1]);
      // item === 0 && setDraggedX(0);
      // if (
      //   item === cumulatedValues.length - 1 &&
      //   containerRef.current.scrollWidth - 265 >
      //     cumulatedValues[item - 1] - characterCounts[item - 1]
      // ) {
      //   setDraggedX(containerRef.current.scrollWidth - 265);
      // }
    }
  };

  const listSprings = useSprings(
    List.length,
    List.map((item) => ({
      backgroundColor:
        item[0] === selectedCategory[0] ? `var(--Bc-3)` : `var(--Ec-4)`,
    }))
  );

  const listSpringsOpen = useSprings(
    List.length,
    List.map((item) => ({
      backgroundColor:
        item[0] === selectedCategory[0] ? `var(--Bc-3)` : `var(--Ec-4)`,
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
      top: isLongPress
        ? `calc(70% - ${listSprings.length * 40 - 50}px)`
        : `calc(70% - ${listSprings.length * 40}px)`,
    },
    to: {
      opacity: !isLongPress ? 0 : 1,
      position: "absolute",
      top: !isLongPress
        ? `calc(70% - ${listSprings.length * 40 - 50}px)`
        : `calc(70% - ${listSprings.length * 40}px)`,
      zIndex: 100,
      height: `calc(70% + ${listSprings.length * 15}px)`,
      overflow: "visible",
      background: "none",
      outline: "none",
      display: "flex",
      marginLeft: 10,
    },
    config: { duration: 1000, easing: easings.easeOutExpo },
  });
  const ApearP = useSpring({
    opacity: !isLongPress ? 0 : 1,
    top: !isLongPress ? 0 : -15,
    delay: !isLongPress ? 0 : 200,
  });
  const ApearItems = useSpring({
    flexDirection: "column",
    alignItems: "flex-start",
    left: 0,
    background: "none",
    flexWrap: "wrap",
    width: "auto",
  });
  const Apearh2 = useSpring({
    marginBottom: 4,
  });

  return (
    <>
      <animated.li className="Add_Category" {...longBind()} style={Apear}>
        <animated.p style={ApearP}>Select a category : </animated.p>{" "}
        <animated.div className="Add_Category_items" style={ApearItems}>
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
