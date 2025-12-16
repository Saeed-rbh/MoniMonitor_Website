import React, { useState, useEffect } from "react";
import { animated, useSpring } from "react-spring";
import { ScalableElement } from "../Tools/tools";
import { MdModeEditOutline } from "react-icons/md";

const Reason = ({
  Reason,
  setReason,
  defaultValue,
  isLongPress,
  addStage,
  isAddClicked,
  setAddStage,
  index,
  topAdd,
  opacity,
  handleStage,
}) => {
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
          : addStage < index || addStage === 3 || opacity
          ? "blur(10px)"
          : !isLongPress
          ? "blur(0px)"
          : "blur(10px)",
      y: addStage > index ? 0 : 0,
      position: "absolute",
      cursor: addStage === null ? "pointer" : "auto",
      top: 113,
      height: addStage > index ? 100 : 295,
      y: topAdd,
      opacity: addStage === 3 || opacity ? 0.5 : 1,
      zIndex: 100002,
    },
  });
  const backgroundStyle = useSpring({
    opacity: addStage !== index ? 1 : 0,
  });

  const labeledit = useSpring({
    left: addStage === index ? 59 : 39,
  });

  const [ReasonCount, setReasonCount] = useState(0);

  const handleReason = (event) => {
    const newValue = event.target.value.replace(/\n/g, "").slice(0, 50);
    setReason(newValue);
    setReasonCount(newValue.length);
  };

  const handleErase = () => {
    setReason("");
    setReasonCount(0);
  };

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
    left: addStage === index ? 70 : 50,
    width: "max-content",
    margin: 0,
    position: "absolute",
    fontSize: "0.7em",
    color: "var(--Bc-1)",
    padding: "5px 10px",
    borderRadius: "30px",
  });

  const textareaStyle = useSpring({
    top: addStage === index ? 80 : 20,
    left: addStage === index ? 0 : 100,
    margin: `0 1px`,
    height: 100,
    padding: "15px 20px",
    position: "absolute",
    fontSize: "0.7em",
    color: "var(--Ac-1)",
    outline:
      addStage === index ? "1px solid var(--Bc-2)" : "1px solid var(--Ec-4)",
    borderRadius: "25px",
    background:
      addStage === index
        ? "linear-gradient(165deg, var(--Ac-4) -20%, var(--Ec-1) 120%)"
        : "none",
  });

  const characterStyle = useSpring({
    bottom: "auto",
    top: 140,
    left: 20,
    opacity: addStage === index ? 1 : 0,
  });

  const clearStyle = useSpring({
    bottom: "auto",
    top: 115,
    right: 15,
    opacity: addStage === index ? 1 : 0,
  });

  const incomeExample = [
    "Salary Payment",
    "Freelance Project",
    "Bonus",
    "Investment Return",
    "Gift Received",
    "Sale of Goods",
    "Rental Income",
    "Consulting Fee",
    "Stock Dividend",
    "Loan Repayment",
  ];
  const expenseExample = [
    "Groceries",
    "Rent Payment",
    "Utilities Bill",
    "Dining Out",
    "Fuel for Car",
    "Subscription Service",
    "Insurance Payment",
    "Clothing Purchase",
    "Medical Expenses",
    "Entertainment",
  ];
  const saveExample = [
    "Emergency Fund Contribution",
    "Retirement Savings",
    "Stock Purchase",
    "Bond Investment",
    "Real Estate Investment",
    "Mutual Fund Contribution",
    "Saving for Vacation",
    "Saving for a New Car",
    "Child's Education Fund",
    "Cryptocurrency Investment",
  ];
  const [example, setExample] = useState(null);

  const getRandomExamples = (array) => {
    const shuffled = array.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 4);
  };

  useEffect(() => {
    if (isAddClicked === "Income") {
      setExample(getRandomExamples(incomeExample));
    } else if (isAddClicked === "Expense") {
      setExample(getRandomExamples(expenseExample));
    } else {
      setExample(getRandomExamples(saveExample));
    }
  }, [isAddClicked]);
  const exampleStyle = useSpring({
    opacity: addStage === index ? 1 : 0,
    x: addStage === index ? 0 : -20,
    y: addStage === index ? 105 : 65,
    scale: addStage === index ? 1 : 0.95,
    flexDirection: "row",
    flexWrap: "wrap",
  });

  return (
    <animated.li
      className="Add_Reason"
      style={fade}
      onClick={() => handleStage(index)}
    >
      <animated.div
        className="Add_background"
        style={backgroundStyle}
      ></animated.div>
      <animated.div style={labelPar}>
        <animated.h4 style={label}>
          {addStage === index ? "Reason" : <MdModeEditOutline />}
        </animated.h4>
      </animated.div>
      <animated.label style={labelTitle}>
        {addStage === index && `What is the`} Reason:{" "}
      </animated.label>
      {(addStage === index || ReasonCount < 45) && (
        <animated.div className="Add_edit" style={labeledit}>
          Briefly describe the purpose of this transaction.
        </animated.div>
      )}
      <animated.textarea
        type="text"
        maxLength={50}
        placeholder={
          addStage === index ? example && example[0] : "No Reason Provided"
        }
        value={Reason}
        onChange={handleReason}
        style={textareaStyle}
      />
      <animated.h1 style={characterStyle}>
        Character:<span>{ReasonCount} </span>| 50
      </animated.h1>
      <ScalableElement as="h2" onClick={handleErase} style={clearStyle}>
        Clear All
      </ScalableElement>

      {addStage === index && example && (
        <animated.div
          className="AddTransactionFeed_Examples"
          style={exampleStyle}
        >
          <animated.p style={{ margin: "5px" }}>
            <span>{isAddClicked}</span>{" "}
            <span style={{ marginLeft: "7px" }}>Shorcuts :</span>
          </animated.p>
          {example.map((value, index) => (
            <ScalableElement
              key={index}
              as="h4"
              onClick={() => handleReason({ target: { value } })}
              style={{
                width: "fit-content",
                margin: "3px",
                transform: "translateY(25px)",
              }}
            >
              {value}
            </ScalableElement>
          ))}
        </animated.div>
      )}
    </animated.li>
  );
};

export default Reason;
