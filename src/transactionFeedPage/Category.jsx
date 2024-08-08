import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useSprings, useSpring, animated } from "react-spring";
import { useDrag } from "@use-gesture/react";
import { ScalableElement } from "../Tools/tools";
import { useLongPress } from "use-long-press";

const Category = ({
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
    setDraggedX(0);
    setSelectedCategory(List[0]);
    setCharacterCounts(characterCountsIni);
    setCumulatedValues(cumulatedValuesIni);
  }, [characterCountsIni, cumulatedValuesIni, List, setSelectedCategory]);

  const handleClick = (item) => {
    if (isDragging) {
      setIsLongPress(false);
      setSelectedCategory(List[item]);
    }
  };

  useEffect(() => {
    const index = List.findIndex((item) => selectedCategory[0] === item[0]);
    index !== 0 &&
      index !== cumulatedValues.length - 1 &&
      setDraggedX(cumulatedValues[index - 1]);
    selectedCategory === 0 && setDraggedX(0);
    if (
      index === cumulatedValues.length - 1 &&
      containerRef.current.scrollWidth - 265 >
        cumulatedValues[index - 1] - characterCounts[index - 1]
    ) {
      setDraggedX(containerRef.current.scrollWidth - 265);
    }
  }, [selectedCategory]);

  const listSprings = useSprings(
    List.length,
    List.map((item) => ({
      backgroundColor:
        item[0] === selectedCategory[0] ? `var(--Bc-3)` : `var(--Ec-4)`,
    }))
  );

  const dragSpring = useSpring({
    transform: `translateX(-${draggedX}px)`,
  });

  const bind = useDrag(({ movement: [mx], dragging }) => {
    const maxDrag =
      containerRef.current.scrollWidth - containerRef.current.clientWidth;
    const newDraggedX = draggedX - mx / 15;
    const constrainedX = Math.max(0, Math.min(maxDrag, newDraggedX));
    mx !== 0 && setDraggedX(constrainedX);
    isDragging && setIsDragging(mx !== 0 ? false : true);
  });

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

  const longBind = useLongPress(true ? startLongPress : null, {
    onStart: (event) => {
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("touchmove", handleMove);
    },
  });

  const fade = useSpring({
    filter: !isLongPress ? "blur(0px)" : "blur(10px)",
  });

  return (
    <animated.li className="Add_Category" {...longBind()} style={fade}>
      <p>Category | </p>{" "}
      <div className="Add_Category_items" ref={containerRef} {...bind()}>
        <animated.div className="Add_Category_items_in" style={dragSpring}>
          {listSprings.map((animation, index) => (
            <ScalableElement
              style={{ ...animation, width: `${characterCounts[index]}px` }}
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
      </div>
    </animated.li>
  );
};

export default Category;
