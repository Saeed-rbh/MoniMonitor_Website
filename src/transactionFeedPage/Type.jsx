import React, { useEffect, useState, useCallback } from "react";
import { useSprings, useSpring, animated } from "react-spring";
import { GoArrowUpRight, GoArrowDownLeft, GoPlus } from "react-icons/go";
import { ScalableElement } from "../Tools/tools";
import { MdModeEditOutline } from "react-icons/md";

const transactionTypes = [
  { label: "Income", icon: <GoArrowDownLeft color="var(--Fc-2)" /> },
  { label: "Expense", icon: <GoArrowUpRight color="var(--Gc-2)" /> },
  { label: "Save&Invest", icon: <GoPlus color="var(--Ac-2)" /> },
];

const getTransactionSpringConfig = (
  dataIndex,
  addStage,
  index,
  whichType,
  selectedType,
  selectedChar
) => ({
  top: addStage === index ? `${65 + dataIndex * 57}px` : `-2px`,
  opacity:
    addStage !== index
      ? whichType === transactionTypes[dataIndex].label
        ? 1
        : 0
      : 1,
  backgroundColor:
    addStage === index && whichType === transactionTypes[dataIndex].label
      ? `var(--Bc-3)`
      : `var(--Ac-4)`,
  position: "absolute",
  padding: addStage === index ? "0px 25px 0px 20px" : "10px 10px 10px 10px",
  background:
    addStage === index
      ? "linear-gradient(165deg, var(--Ac-4) -20%, var(--Ec-1) 120%)"
      : "none",
  left:
    addStage === index
      ? `75px`
      : `${255 - selectedType * (85 + selectedChar) + dataIndex * 80}px`,
  outline:
    addStage === index ? "1px solid var(--Ac-3)" : "1px solid var(--Ec-4)",
});

const Type = ({
  whichType,
  setWhichType,
  isLongPress,
  addStage,
  setAddStage,
  index,
  topAdd,
  opacity,
  handleStage,
}) => {
  const [selectedType, setSelectedType] = useState(0);
  useEffect(() => {
    setSelectedType(
      whichType === "Income" ? 0 : whichType === "Expense" ? 1 : 2
    );
  }, [whichType]);
  const [selectedChar, setSelectedChar] = useState(0);

  const handleClick = useCallback(
    (label, selected) => {
      setWhichType(label);
      setAddStage(index + 1);
      setSelectedType(selected);
      setSelectedChar(label.length);
    },
    [setWhichType, setAddStage]
  );

  const transactionSprings = useSprings(
    transactionTypes.length,
    transactionTypes.map((_, dataIndex) =>
      getTransactionSpringConfig(
        dataIndex,
        addStage,
        index,
        whichType,
        selectedType,
        selectedChar
      )
    )
  );

  const fadeStyle = useSpring({
    filter:
      opacity || isLongPress || addStage === 3 ? "blur(10px)" : "blur(0px)",
    flexDirection: "column",
    borderRadius: "0px",
    border: "none",
    height: "max-content",
    alignItems: "flex-start",
    zIndex: 100004,
    cursor: addStage === null ? "pointer" : "auto",
    y: topAdd,
    opacity: opacity || addStage === 3 ? 0.5 : 1,
  });

  const labelStyle = useSpring({
    position: "relative",
    fontSize: addStage !== index ? "1rem" : "0.7rem",
    color: "var(--Bc-2)",
    borderRadius: "18px",
    width: addStage !== index ? 45 : 65,
    height: 45,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: addStage !== index ? "pointer" : "auto",
    backgroundColor: addStage !== index ? "var(--Ec-2)" : "var(--Ac-5)",
    left: 7,
    top: addStage === index ? 12 : 7,
  });

  const labelEditStyle = useSpring({
    top: addStage === index ? 30 : 22,
    left: addStage === index ? 63 : 39,
    opacity: addStage === index ? 0.6 : 0.5,
    color: "var(--Ac-2)",
  });

  const amountLabelStyle = useSpring({
    color: "var(--Bc-1)",
    fontSize: `0.7rem`,
    position: "absolute",
    top: addStage === index ? 23 : 13,
    left: addStage === index ? 85 : 60,
  });

  return (
    <animated.div
      className="Add_Type"
      style={fadeStyle}
      onClick={() => handleStage(index)}
    >
      <div
        className="Add_background"
        style={{ top: 0, opacity: addStage !== index ? 1 : 0 }}
      />
      <div className="Add_label_container">
        <animated.h2 style={labelStyle}>
          {addStage === index ? "Type" : <MdModeEditOutline />}
        </animated.h2>
      </div>
      <animated.label style={amountLabelStyle}>
        {addStage === index && `Insert`} Transaction Type:
      </animated.label>
      <animated.div className="Add_edit" style={labelEditStyle}>
        Select a type for better organization
      </animated.div>

      {transactionSprings.map((springStyle, dataIndex) => (
        <ScalableElement
          key={transactionTypes[dataIndex].label}
          as="h1"
          onClick={() =>
            handleClick(transactionTypes[dataIndex].label, dataIndex)
          }
          style={springStyle}
        >
          {transactionTypes[dataIndex].icon}
          <span>{transactionTypes[dataIndex].label.replace("&", " & ")}</span>
        </ScalableElement>
      ))}
    </animated.div>
  );
};

export default Type;
