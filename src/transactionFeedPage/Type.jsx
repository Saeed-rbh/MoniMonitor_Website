import React from "react";
import { useSprings, useSpring, animated } from "react-spring";
import { GoArrowUpRight, GoArrowDownLeft, GoPlus } from "react-icons/go";
import { ScalableElement } from "../Tools/tools";
import { MdModeEditOutline } from "react-icons/md";

const Type = ({
  whichType,
  setWhichType,
  isLongPress,
  addStage,
  setAddStage,
}) => {
  const handleClick = (label) => {
    setWhichType(label);
    setAddStage(1);
  };
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
      top: addStage === 0 ? `${35 + index * 57}px` : `-2px`,
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
      padding: addStage === 0 ? "0px 25px 0px 20px" : "10px 10px 10px 10px",
      background:
        addStage === 0
          ? "linear-gradient(165deg, var(--Ac-4) -20%, var(--Ec-1) 120%)"
          : "none",
      left: addStage === 0 ? 70 : 140,
      outline:
        addStage === 0 ? "1px solid var(--Ac-3)" : "1px solid var(--Ec-4)",
    }))
  );

  const fade = useSpring({
    filter: !isLongPress ? "blur(0px)" : "blur(10px)",
    flexDirection: "column",
    borderRadius: "0px",
    border: "none",
    height: "max-content",
    alignItems: "flex-start",
    // marginLeft: "10px",
    // top: 5,
    zIndex: 10000,
    // left: addStage === 0 ? 20 : 0,
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
    fontSize: "0.7em",
    color: "var(--Bc-1)",
    width: 50,
    padding: "10px 5px",
    position: "absolute",
    top: 0,
    left: addStage === 0 ? 60 : 25,
  });

  const label = useSpring({
    fontSize: addStage !== 0 ? "1rem" : "0.7rem",
    color: "var(--Bc-2)",
    // border: "1px solid var(--Bc-2)",
    borderRadius: "30px",
    width: addStage !== 0 ? 35 : 70,
    height: 35,
    // padding: "10px 5px",
    display: "flex",
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    top: 0,
    // left: -10,
    margin: 0,
    cursor: addStage !== 0 ? "pointer" : "auto",
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
  // const label = useSpring({
  //   position: "relative",
  //   fontSize: addStage !== 2 ? "1rem" : "0.7rem",
  //   color: "var(--Bc-2)",
  //   border: "1px solid var(--Bc-2)",
  //   borderRadius: "30px",
  //   width: addStage !== 2 ? 35 : 70,
  //   height: 35,
  //   // padding: "10px 5px",
  //   display: "flex",
  //   position: "absolute",
  //   alignItems: "center",
  //   justifyContent: "center",
  //   marginTop: addStage !== 2 ? 15 : 20,
  //   cursor: addStage !== 2 ? "pointer" : "auto",
  // });

  const labelTitle = useSpring({
    top: addStage > 2 ? 27 : 30,
    left: addStage > 2 ? 30 : 75,
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
    top: 25,
  });
  const AnountStyle = useSpring({
    color: "var(--Bc-1)",
    fontSize: `0.7rem`,
    // left: addStage > 1 ? 20 : 25,
    position: "absolute",
    top: addStage > 1 ? 15 : 25,
    left: addStage === 1 ? 85 : 40,
  });

  return (
    <animated.div className="Add_Type" style={fade}>
      {/* <animated.h2 style={label}>
        {addStage === 0 ? "Type" : <MdModeEditOutline />}
      </animated.h2>
      <animated.p style={p}>
        {addStage === 0 ? "Select" : ""} Transaction Type:{" "}
      </animated.p> */}
      <animated.div style={labelPar}>
        <animated.h2 style={label}>
          {addStage === 1 ? "Type" : <MdModeEditOutline />}
        </animated.h2>
      </animated.div>
      <animated.label style={AnountStyle}>
        {addStage === 1 && `Insert`} Transaction Type:
      </animated.label>
      <animated.div className="Add_edit" style={labeledit}>
        <MdModeEditOutline /> Tap fot Edit
      </animated.div>
      {transactionSprings.map((springStyle, index) => (
        <ScalableElement
          key={transactionTypes[index].label}
          as="h1"
          onClick={() => handleClick(transactionTypes[index].label)}
          style={{
            ...springStyle,
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
