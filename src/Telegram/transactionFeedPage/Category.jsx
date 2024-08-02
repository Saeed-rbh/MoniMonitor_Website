import React, { useState, useRef, useEffect } from "react";
import { useSprings, useSpring, animated } from "react-spring";
import { useDrag } from "@use-gesture/react";
import { ScalableElement } from "../tools";

const Category = ({
  List,
  selectedCategory,
  setSelectedCategory,
  defaultValue,
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

  return (
    <li className="Add_Category">
      <p>
        Category |{" "}
        <animated.span style={fading ? fadeOutRight : fadeInLeft}>
          {selectedCategory[1]}
          {selectedCategory[0]}
        </animated.span>
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
    </li>
  );
};

export default Category;
