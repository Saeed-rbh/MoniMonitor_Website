import React, { useState, useEffect, useCallback } from "react";
import { MdOutlineBrunchDining } from "react-icons/md";
import { useSpring, animated, config } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { ScalableElement } from "../Tools/tools";

const TransactionListItem = ({
  icon: Icon,
  description,
  time,
  amount,
  isSwiped,
  onSwipe,
  onUnSwipe,
  onClick,
}) => {
  const [showActions, setShowActions] = useState(isSwiped);
  const [showActionsAnim, setShowActionsAnim] = useState(false);
  const [isScaled, setIsScaled] = useState(false);

  const handleMouseDown = useCallback(() => setIsScaled(true), []);
  const handleMouseUp = useCallback(() => setIsScaled(false), []);

  useEffect(() => {
    if (!isSwiped) {
      setShowActions(false);
    }
  }, [isSwiped]);

  const bind = useDrag(
    ({ down, movement: [mx] }) => {
      if (!down && mx < -50) {
        onSwipe();
        setShowActions(true);
        setShowActionsAnim(true);
      } else if (!down && mx > 50) {
        onUnSwipe();
      }
    },
    { axis: "x" }
  );

  console.log("time", time);

  const clockTime = time.split(" ")[1];
  const dateArray = time.split(" ")[0].split("-");
  const date = new Date(dateArray[0], dateArray[1] - 1, dateArray[2]);
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
  }).format(date);

  const swipeAction = useSpring({
    transform: isSwiped ? "translateX(120px)" : "translateX(200px)",
    opacity: isSwiped ? 1 : 0,
    config: config.slow,
    onRest: () => !showActions && setShowActionsAnim(false),
  });

  const swipeStyle = useSpring({
    transform: isSwiped ? "translateX(-120px)" : "translateX(0px)",
    scale: isScaled && !isSwiped ? 0.9 : 1,
  });

  const handleClick = (event) => {
    const { clientY } = event;
    if (onClick) {
      onClick(clientY);
    }
  };

  const truncateDescription = (description, maxLength = 30) => {
    if (description.length > maxLength) {
      return description.substring(0, maxLength - 3) + "...";
    } else {
      return description.padEnd(maxLength, " ");
    }
  };

  return (
    <animated.li
      onClick={handleClick}
      {...bind()}
      style={swipeStyle}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
    >
      <animated.p>
        <animated.span>
          <Icon />
        </animated.span>
        <div className="transaction-Description">
          {truncateDescription(description)}
          <h3>
            {dateArray[2]} | <span>{weekdayName}</span> - {clockTime}
          </h3>
        </div>
      </animated.p>
      <animated.p>${amount}</animated.p>
      {showActionsAnim && (
        <animated.div style={swipeAction} className="transaction-actions">
          <ScalableElement as="div" className="modify-button">
            Modify
          </ScalableElement>
          <ScalableElement as="div" className="delete-button">
            Delete
          </ScalableElement>
        </animated.div>
      )}
    </animated.li>
  );
};

TransactionListItem.defaultProps = {
  icon: MdOutlineBrunchDining,
};

export default TransactionListItem;
