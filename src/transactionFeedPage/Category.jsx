import React, { useState, useRef, useEffect, useMemo } from "react";
import { useSprings, useSpring, animated } from "react-spring";
import { useDrag } from "@use-gesture/react";
import { ScalableElement } from "../Tools/tools";
import useLongPressHandler from "../Tools/useLongPressHandler";
import { MdModeEditOutline } from "react-icons/md";
import AnimatedGradientText from "@/components/ui/animated-gradient-text";
import { cn } from "@/lib/utils";
import MoreCategory from "./MoreCategory";

const Category = ({
  List,
  selectedCategory,
  setSelectedCategory,
  isLongPress,
  setIsLongPress,
  addStage,
  index,
  topAdd,
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
    y: -15,
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

  // const fade = useSpring({
  //   filter:
  //     isLongPress[0] && isLongPress[1] === "Category"
  //       ? "blur(10px)"
  //       : "blur(0px)",
  //   top: 193,
  // });

  const fade = useSpring({
    from: {
      filter: !isLongPress ? "blur(10px)" : "blur(0px)",
      y: addStage > index ? 0 : 0,
      position: "absolute",
    },
    to: {
      filter:
        addStage === null
          ? "blur(0px)"
          : addStage < index || addStage === 3
          ? "blur(10px)"
          : !isLongPress
          ? "blur(0px)"
          : "blur(0px)",
      y: addStage > index ? 0 : 0,
      position: "absolute",
      top: 248,
      height: addStage > index ? 100 : 295,
      y: topAdd,
      opacity: addStage === 3 ? 0.5 : 1,
      zIndex: 100002,
    },
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

  // const label = useSpring({
  //   position: "relative",
  //   fontSize: addStage !== index ? "1rem" : "0.7rem",
  //   color: "var(--Bc-2)",
  //   // border: "1px solid var(--Bc-2)",
  //   borderRadius: "18px",
  //   width: addStage !== index ? 35 : 70,
  //   height: 45,
  //   width: 45,
  //   // padding: "10px 5px",
  //   display: "flex",
  //   position: "absolute",
  //   alignItems: "center",
  //   justifyContent: "center",
  //   marginTop: addStage !== index ? 15 : 20,
  //   cursor: addStage !== index ? "pointer" : "auto",
  //   backgroundColor: "var(--Ec-2)",
  //   left: 7,
  //   top: 7,
  // });

  const label = useSpring({
    position: "relative",
    fontSize: addStage !== index ? "1rem" : "0.7rem",
    color: "var(--Bc-2)",
    borderRadius: "18px",
    width: addStage !== index ? 35 : 70,
    height: 45,
    width: addStage !== index ? 45 : 65,
    display: "flex",
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    cursor: addStage !== index ? "pointer" : "auto",
    top: addStage !== 0 ? 3 : 12,
    backgroundColor: addStage !== index ? "var(--Ec-2)" : "var(--Ac-5)",
    left: addStage === index ? 0 : 7,
    top: 23,
    margin: 0,
  });

  const labelTitle = useSpring({
    top: addStage > index ? 30 : 30,
    left: addStage > index ? 50 : 75,
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
  const labeledit = useSpring({
    // opacity: addStage === index ? 0 : 0.5,
    left: addStage === index ? 62 : 39,
  });
  const backgroundStyle = useSpring({
    opacity: addStage !== index ? 1 : 0,
  });

  const items_in_h2 = useSpring({
    right: addStage === index ? 0 : 20,
  });

  return (
    <animated.li className="Add_Category" {...longBind()} style={fade}>
      <animated.div
        className="Add_background"
        style={backgroundStyle}
      ></animated.div>
      <animated.div style={labelPar}>
        {/* <animated.h4 style={labelDot}></animated.h4>{" "} */}
        <animated.h4 style={label}>
          {addStage === index ? "Reason" : <MdModeEditOutline />}
        </animated.h4>
      </animated.div>
      <animated.label style={labelTitle}>
        {addStage === index && `What is the`} Category:{" "}
      </animated.label>
      <animated.div className="Add_edit" style={labeledit}>
        {" "}
        <AnimatedGradientText>
          {" "}
          <span
            className={cn(
              `inline animate-gradient bg-gradient-to-r from-[var(--Ac-3)] via-[var(--Ac-1)] to-[var(--Ac-3)] bg-[length:var(--bg-size)_100%] bg-clip-text text-transparent`
            )}
          >
            Auto Detect
          </span>
        </AnimatedGradientText>{" "}
        uses AI to identify category.
      </animated.div>
      <div className="Add_Category_items" ref={containerRef} {...bind()}>
        <animated.div className="Add_Category_items_in" style={dragSpring}>
          <animated.h2 style={items_in_h2}>
            {selectedCategory[1]}
            {selectedCategory[0]}
          </animated.h2>

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
      <MoreCategory
        List={List}
        setSelectedCategory={setSelectedCategory}
        selectedCategory={selectedCategory}
        defaultValue={""}
        isLongPress={addStage === index}
        setIsLongPress={setIsLongPress}
      />
    </animated.li>
  );
};

export default Category;
