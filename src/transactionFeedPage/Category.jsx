import React, { useState, useRef, useEffect, useMemo } from "react";
import { useSprings, useSpring, animated } from "react-spring";
import { useDrag } from "@use-gesture/react";
import { ScalableElement } from "../Tools/tools";
import useLongPressHandler from "../Tools/useLongPressHandler";
import { MdModeEditOutline } from "react-icons/md";

const Category = ({
  List,
  selectedCategory,
  setSelectedCategory,
  isLongPress,
  setIsLongPress,
  addStage,
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
    setSelectedCategory(selectedCategory);
    setCharacterCounts(characterCountsIni);
    setCumulatedValues(cumulatedValuesIni);
  }, [characterCountsIni, cumulatedValuesIni, List, setSelectedCategory]);

  const handleClick = (item) => {
    if (isDragging) {
      setIsLongPress([false, null]);
      setSelectedCategory(List[item]);
    }
  };

  useEffect(() => {
    const index = List.findIndex((item) => selectedCategory[0] === item[0]);
    if (index === 0) {
      setDraggedX(0);
    } else if (index !== cumulatedValues.length - 1) {
      setDraggedX(cumulatedValues[index - 1]);
    } else if (
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
    marginLeft: 15,
  });

  const bind = useDrag(({ movement: [mx], dragging }) => {
    const maxDrag =
      containerRef.current.scrollWidth - containerRef.current.clientWidth;
    const newDraggedX = draggedX - mx / 15;
    const constrainedX = Math.max(0, Math.min(maxDrag, newDraggedX));
    mx !== 0 && setDraggedX(constrainedX);
    isDragging && setIsDragging(mx !== 0 ? false : true);
  });

  const longBind = useLongPressHandler({
    isLongPress: isLongPress,
    setIsLongPress: setIsLongPress,
    component: "Category",
  });

  const fade = useSpring({
    filter:
      isLongPress[0] && isLongPress[1] === "Category"
        ? "blur(10px)"
        : "blur(0px)",
    top: 150,
  });

  const labelPar = useSpring({
    position: "absolute",
    height: 100,
    top: 5,
    left: 0,
    margin: 0,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    flexDirection: "column",
    margin: 0,
  });
  const labelDot = useSpring({
    position: "relative",
    fontSize: "1.5em",
    color: "var(--Bc-2)",
    margin: "5px 10px 0px 17px",
    lineHeight: `15px`,
    width: 2,
    height: addStage > 2 ? 2 : 7,
    borderRadius: 30,
    background: "var(--Bc-2)",
  });
  const label = useSpring({
    position: "relative",
    fontSize: addStage !== 2 ? "1rem" : "0.7rem",
    color: "var(--Bc-2)",
    // border: "1px solid var(--Bc-2)",
    borderRadius: "20px",
    width: addStage !== 2 ? 35 : 70,
    height: 45,
    width: 45,
    // padding: "10px 5px",
    display: "flex",
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    marginTop: addStage !== 2 ? 15 : 20,
    cursor: addStage !== 2 ? "pointer" : "auto",
    backgroundColor: "var(--Ec-1)",
    left: 7,
    top: 7,
  });

  const labelTitle = useSpring({
    top: addStage > 2 ? 27 : 30,
    left: addStage > 2 ? 55 : 75,
    width: "max-content",
    margin: 0,
    position: "absolute",
    fontSize: "0.7em",
    color: "var(--Bc-1)",
    padding: "5px 10px",
    borderRadius: "30px",
    display: "flex",
    alignItems: "center",
  });

  return (
    <animated.li className="Add_Category" {...longBind()} style={fade}>
      <div className="Add_background"></div>
      <animated.div style={labelPar}>
        <animated.h4 style={labelDot}></animated.h4>{" "}
        <animated.h4 style={label}>
          {addStage === 2 ? "Reason" : <MdModeEditOutline />}
        </animated.h4>
      </animated.div>
      <animated.label style={labelTitle}>
        {addStage === 2 && `What is the`} Category:{" "}
      </animated.label>
      <div className="Add_edit">
        <MdModeEditOutline /> Tap fot Edit
      </div>
      <div className="Add_Category_items" ref={containerRef} {...bind()}>
        <animated.div className="Add_Category_items_in" style={dragSpring}>
          <h2>
            {selectedCategory[1]}
            {selectedCategory[0]}
          </h2>

          {/* {listSprings.map((animation, index) => (
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
          ))} */}
        </animated.div>
      </div>
    </animated.li>
  );
};

export default Category;
