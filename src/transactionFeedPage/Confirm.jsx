import React from "react";
import { ScalableElement } from "../Tools/tools";
import { useSpring, animated } from "react-spring";

const Confirm = ({ handleAddClick, isLongPress }) => {
  const fade = useSpring({
    filter: !isLongPress ? "blur(0px)" : "blur(10px)",
  });
  return (
    <animated.li className="Add_Confirm" style={fade}>
      <ScalableElement as="h2" onClick={() => handleAddClick()}>
        Add Transaction
      </ScalableElement>
    </animated.li>
  );
};

export default Confirm;
