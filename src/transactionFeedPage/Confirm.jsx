import React from "react";
import { ScalableElement } from "../Tools/tools";
import { animated } from "react-spring";

const Confirm = ({ handleAddClick }) => {
  return (
    <animated.li className="Add_Confirm">
      <ScalableElement as="h2" onClick={() => handleAddClick()}>
        Add Transaction
      </ScalableElement>
    </animated.li>
  );
};

export default Confirm;
