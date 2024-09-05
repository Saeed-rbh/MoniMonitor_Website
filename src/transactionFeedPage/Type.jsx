import React from "react";
import { useSprings, useSpring, animated } from "react-spring";
import { GoArrowUpRight, GoArrowDownLeft, GoPlus } from "react-icons/go";
import { ScalableElement } from "../Tools/tools";

const Type = ({
  whichType,
  setWhichType,
  isLongPress,
  addStage,
  setAddStage,
}) => {
  // Define transaction types as an array of objects
  const transactionTypes = [
    {
      label: "Income",
      icon: <GoArrowDownLeft color="var(--Fc-2)" />,
    },
    {
      label: "Expense",
      icon: <GoArrowUpRight color="var(--Gc-2)" />,
    },
    {
      label: "Save&Invest",
      icon: <GoPlus color="var(--Ac-2)" />,
    },
  ];

  const transactionSprings = useSprings(
    transactionTypes.length,
    transactionTypes.map((_, index) => ({
      top: addStage === 0 ? `${25 + index * 57}px` : `-18px`,
      marginTop: addStage === 0 ? "25px" : "0px",
      opacity:
        addStage !== 0
          ? whichType === transactionTypes[index].label
            ? 1
            : 0
          : 1,
      backgroundColor:
        addStage === 0
          ? whichType === transactionTypes[index].label
            ? `var(--Bc-3)`
            : `var(--Ec-4)`
          : `none`,
      position: "absolute",
      padding: addStage === 0 ? "0px 25px 0px 20px" : "0px 0px 0px 0px",
      margin: "3px 5px",
      background:
        addStage === 0
          ? "linear-gradient(165deg, var(--Ac-4) -20%, var(--Ec-1) 120%)"
          : "none",
      left: addStage === 0 ? 0 : 120,
      outline:
        addStage === 0 ? "1px solid var(--Ac-3)" : "1px solid var(--Ec-4)",
      config: { tension: 170, friction: 26 }, // Customize animation behavior
    }))
  );

  // Fade animation for the container
  const fade = useSpring({
    filter: !isLongPress ? "blur(0px)" : "blur(10px)",
    flexDirection: "column",
    borderRadius: "0px",
    border: "none",
    height: "max-content",
    alignItems: "flex-start",
    marginLeft: "10px",
    top: 5,
    left: addStage === 0 ? 20 : 0,
  });

  const each = useSpring({
    position: "absolute",
    padding: addStage === 0 ? "0px 25px 0px 20px" : "0px 0px 0px 0px",
    margin: "3px 5px",
    background:
      addStage === 0
        ? "linear-gradient(165deg, var(--Ac-4) -20%, var(--Ec-1) 120%)"
        : "none",
    left: addStage === 0 ? 0 : 120,
    outline: addStage === 0 ? "1px solid var(--Ac-3)" : "1px solid var(--Ec-4)",
  });

  const p = useSpring({
    position: "absolute",
    top: 0,
  });

  const handleClick = (label) => {
    setWhichType(label);
    setAddStage(1);
  };

  return (
    <animated.div className="Add_Type" style={fade}>
      <animated.p style={p}>
        {addStage === 0 ? "Select" : ""} Transaction Type:{" "}
      </animated.p>
      {/* {transactionTypes.map(({ label, icon }, index) => ( */}
      {transactionSprings.map((springStyle, index) => (
        <ScalableElement
          key={transactionTypes[index].label}
          as="h1"
          onClick={() => handleClick(transactionTypes[index].label)}
          style={{
            ...springStyle,
            // ...each,
            // marginTop: addStage === 0 ? "25px" : "0px",
            // top: addStage === 0 ? `${index * 57}px` : `-18px`, // Dynamically set top based on index
            // opacity: addStage === 1 ? (whichType === label ? 1 : 0) : 1,
            // backgroundColor:
            //   addStage === 0
            //     ? whichType === label
            //       ? `var(--Bc-3)`
            //       : `var(--Ec-4)`
            //     : `none`,
          }}
        >
          {transactionTypes[index].icon}
          <span>{transactionTypes[index].label.replace("&", " & ")}</span>
        </ScalableElement>
      ))}
    </animated.div>
  );
};

export default Type;
