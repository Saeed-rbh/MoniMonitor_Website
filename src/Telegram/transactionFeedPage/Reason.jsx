import React, { useState } from "react";
import { animated } from "react-spring";
import { ScalableElement } from "../tools";

const Reason = ({ reason, setReason, defaultValue }) => {
  const [ReasonCount, setReasonCount] = useState(0);

  const handleReason = (event) => {
    const newValue = event.target.value.replace(/\n/g, "");
    setReason(newValue);
    setReasonCount(newValue.length);
  };

  const handleErase = () => {
    setReason("");
    setReasonCount(0);
  };

  return (
    <li className="Add_Reason">
      <animated.label>Reason | </animated.label>
      <animated.textarea
        type="text"
        inputMode="50"
        placeholder="Shopping for party"
        defaultValue={defaultValue}
        value={reason}
        onChange={handleReason}
      />
      <animated.h1>
        Character:<span>{ReasonCount} </span>| 50
      </animated.h1>
      <ScalableElement as="h2" onClick={handleErase}>
        Clear All
      </ScalableElement>
      <hr />
      <hr />
    </li>
  );
};

export default Reason;
