import React, { useState } from "react";
import { animated, useSpring } from "react-spring";
import { ScalableElement } from "../Tools/tools";

const Reason = ({ reason, setReason, defaultValue, isLongPress }) => {
  const fade = useSpring({
    filter: !isLongPress ? "blur(0px)" : "blur(10px)",
  });

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
    <animated.li className="Add_Reason" style={fade}>
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
    </animated.li>
  );
};

export default Reason;
