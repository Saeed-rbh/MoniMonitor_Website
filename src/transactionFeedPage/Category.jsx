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
    return List.map((item) => Math.round(item[0].length * 7.35 + 40));
  }, [List]);
  const [characterCounts, setCharacterCounts] = useState(characterCountsIni);

  const cumulatedValuesIni = useMemo(() => {
    return characterCounts.reduce((acc, value) => {
      const lastValue = acc.length > 0 ? acc[acc.length - 1] : 0;
      acc.push(lastValue + value - 5 * acc.length);
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
      item !== 0 &&
        item !== cumulatedValues.length - 1 &&
        setDraggedX(cumulatedValues[item - 1]);
      item === 0 && setDraggedX(0);
      containerRef.current.style.transform = `translateX(0px)`;
    }
  };

  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.clientWidth);
      setContentWidth(containerRef.current.scrollWidth);
    }
  }, []);

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

  const dragSpring = useSpring({
    transform: `translateX(-${draggedX}px)`,
  });

  const bind = useDrag(({ movement: [mx], dragging }) => {
    const maxDrag = contentWidth - containerWidth;
    const newDraggedX = draggedX - mx / 15;
    const constrainedX = Math.max(0, Math.min(maxDrag, newDraggedX));
    setDraggedX(constrainedX);
    isDragging && setIsDragging(mx !== 0 ? false : true);
  });

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

  const fade = useSpring({
    filter: !isLongPress ? "blur(0px)" : "blur(10px)",
  });

  const Apear = useSpring({
    opacity: !isLongPress ? 0 : 1,
    position: "absolute",
    top: !isLongPress
      ? "calc(70% - 0px)"
      : `calc(70% - ${listSprings.length * 40}px)`,
    zIndex: 100,
    height: `calc(70% + ${listSprings.length * 15}px)`,
    overflow: "visible",
    background: "none",
    outline: "none",
    display: "flex",
    marginLeft: 10,
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
      {isLongPress && (
        <animated.li className="Add_Category" {...longBind()} style={Apear}>
          <animated.p style={ApearP}>Select a category : </animated.p>{" "}
          <animated.div className="Add_Category_items" style={ApearItems}>
            {listSpringsOpen.map((animation, index) => (
              <ScalableElement
                style={{ ...animation, ...Apearh2 }}
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
      )}
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
    </>
  );
};

export default Category;
