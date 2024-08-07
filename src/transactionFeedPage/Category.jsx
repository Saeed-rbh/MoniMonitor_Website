import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSprings, useSpring, animated } from "react-spring";
import { useDrag } from "@use-gesture/react";
import { ScalableElement } from "../Tools/tools";
import { useLongPress } from "use-long-press";

const Category = ({
  List,
  selectedCategory,
  setSelectedCategory,
  defaultValue,
  isLongPress,
  setIsLongPress,
}) => {
  const containerRef = useRef(null);

  const [fading, setFading] = useState(false);
  const [newCategory, setNewCategory] = useState(
    defaultValue.length > 0 ? defaultValue : List[0]
  );

  const [isDragging, setIsDragging] = useState(false);

  const handleChangeCategory = (newCategory) => {
    if (newCategory === selectedCategory) return;
    setFading(true);
    setNewCategory(newCategory);
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleClick = (item) => {
    if (isDragging) {
      handleChangeCategory(List[item]);
      setIsLongPress(false);
    }
  };

  const fadeOutRight = useSpring({
    opacity: fading ? 0 : 1,
    transform: fading ? "translateX(10px)" : "translateX(0px)",
    config: { duration: 400 },
    onRest: () => {
      setSelectedCategory(newCategory);
      setTimeout(() => setFading(false), 200);
    },
  });

  const fadeInLeft = useSpring({
    opacity: !fading ? 1 : 0,
    transform: !fading ? "translateX(0px)" : "translateX(-10px)",
    config: { duration: 300 },
  });

  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.clientWidth);
      setContentWidth(containerRef.current.scrollWidth);
    }
  }, []);

  const [draggedX, setDraggedX] = useState(0);

  const listSprings = useSprings(
    List.length,
    List.map((item) => ({
      transform: `translateX(-${draggedX}px)`,
      backgroundColor:
        item[0] === selectedCategory[0] ? `var(--Bc-3)` : `var(--Ec-4)`,
    }))
  );

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
    }, 500); // Long press threshold
  }, []);

  const handleMove = useCallback(
    (event) => {
      if (isLongPress) {
        // setIsLongPress(false);
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
    // height: !isLongPress ? "0%" : "100%",
    flexWrap: "wrap",
    width: "auto",
  });
  const Apearh2 = useSpring({
    marginBottom: 4,
  });
  const ApearLine = useSpring({
    position: "absolute",
    bottom: "10%",
    left: 22,
    width: 2,
    height: !isLongPress ? "0%" : "55%",
    background: "var(--Bc-3)",
    borderRadius: 20,
  });
  return (
    <>
      <animated.li className="Add_Category" {...longBind()} style={Apear}>
        {/* <animated.div style={ApearLine}></animated.div> */}
        <animated.p style={ApearP}>
          Select a category :{" "}
          {/* <animated.span style={fading ? fadeOutRight : fadeInLeft}>
          {selectedCategory[1]}
          {selectedCategory[0]}
        </animated.span> */}
        </animated.p>{" "}
        <animated.div
          className="Add_Category_items"
          ref={containerRef}
          style={ApearItems}
        >
          {listSprings.map((animation, index) => (
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
        {/* <div className="Add_Category_guid">
        <VscArrowSmallLeft />

        <span>Drag Left & Right</span>
        <VscArrowSmallRight />
      </div> */}
      </animated.li>
      <animated.li className="Add_Category" {...longBind()} style={fade}>
        <p>
          Category1 |{" "}
          {/* <animated.span style={fading ? fadeOutRight : fadeInLeft}>
          {selectedCategory[1]}
          {selectedCategory[0]}
        </animated.span> */}
        </p>{" "}
        <div className="Add_Category_items" ref={containerRef} {...bind()}>
          {listSprings.map((animation, index) => (
            <ScalableElement
              style={animation}
              as="h2"
              key={index}
              onMouseDown={() => handleMouseDown(index)}
              onClick={() => handleClick(index)}
            >
              {List[index][1]}
              {List[index][0]}
            </ScalableElement>
          ))}
        </div>
        {/* <div className="Add_Category_guid">
        <VscArrowSmallLeft />

        <span>Drag Left & Right</span>
        <VscArrowSmallRight />
      </div> */}
      </animated.li>
    </>
  );
};

export default Category;
