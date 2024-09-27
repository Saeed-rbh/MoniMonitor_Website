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
}) => {
  const fade = useSpring({
    from: {
      filter: !isLongPress ? "blur(10px)" : "blur(0px)",
      // opacity: addStage > 1 ? 0 : 1,
      y: addStage > 1 ? 70 : 50,
      position: "absolute",
    },
    to: {
      filter:
        addStage < 2 ? "blur(10px)" : !isLongPress ? "blur(0px)" : "blur(10px)",
      // opacity: addStage > 1 ? 1 : 0,
      y: addStage > 1 ? 50 : 70,
      position: "absolute",
      top: 44,
      height: 500,
    },
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
  const label = useSpring({
    position: "relative",
    fontSize: addStage !== 2 ? "1rem" : "0.7rem",
    color: "var(--Bc-2)",
    // border: "1px solid var(--Bc-2)",
    borderRadius: "30px",
    width: addStage !== 2 ? 35 : 70,
    height: 35,
    // padding: "10px 5px",
    display: "flex",
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    marginTop: addStage !== 2 ? 15 : 20,
    cursor: addStage !== 2 ? "pointer" : "auto",
  });

  const labelTitle = useSpring({
    top: addStage > 2 ? 25 : 30,
    left: addStage > 2 ? 30 : 75,
    width: "max-content",
    margin: 0,
    position: "absolute",
    fontSize: "0.7em",
    color: "var(--Bc-1)",
    padding: "5px 10px",
    borderRadius: "30px",
  });
  const textareaStyle = useSpring({
    top: addStage > 2 ? 15 : 70,
    left: addStage > 2 ? 90 : 0,
    margin: `0 1px`,
    height: 100,
    padding: "15px 20px",
    position: "absolute",
    fontSize: "0.7em",
    color: "var(--Ac-1)",
    outline:
      addStage > 2
        ? "rgb(255 245 240 / 0%) solid 1px"
        : "1px solid var(--Bc-2)",
    borderRadius: "25px",
    background:
      addStage === 0
        ? "linear-gradient(165deg, var(--Ac-4) -20%, var(--Ec-1) 120%)"
        : "none",
  });

  const characterStyle = useSpring({
    bottom: "auto",
    top: addStage > 2 ? 110 : 130,
    left: 20,
    opacity: addStage > 2 ? 0 : 1,
  });

  const clearStyle = useSpring({
    bottom: "auto",
    top: addStage > 2 ? 100 : 110,
    opacity: addStage > 2 ? 0 : 1,
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
    opacity: addStage === 2 ? 1 : 0,
    x: addStage === 2 ? 0 : -20,
    y: addStage === 2 ? 105 : 65,
    scale: addStage === 2 ? 1 : 0.95,
    flexDirection: "row",
    flexWrap: "wrap",
  });

  return (
    <animated.li className="Add_Reason" style={fade}>
      <animated.div style={labelPar}>
        <animated.h4 style={labelDot}></animated.h4>{" "}
        <animated.h4 style={label}>
          {addStage === 2 ? "Reason" : <MdModeEditOutline />}
        </animated.h4>
      </animated.div>
      <animated.label style={labelTitle}>
        {addStage === 2 && `What is the`} Reason:{" "}
      </animated.label>
      <div className="Add_edit">
        <MdModeEditOutline /> Tap fot Edit
      </div>
      <animated.textarea
        type="text"
        inputMode="50"
        placeholder={
          addStage === 2 ? example && example[0] : "No Reason Provided"
        }
        // defaultValue={defaultValue}
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

      <animated.div
        className="AddTransactionFeed_Examples"
        style={exampleStyle}
      >
        <animated.p>
          <span>{isAddClicked}</span> <span>Shorcuts :</span>
        </animated.p>
        {example &&
          example.map((value, index) => (
            <ScalableElement
              key={index}
              as="h4"
              onClick={() => handleReason({ target: { value } })}
              style={{
                width: "fit-content",
                margin: "3px",
                transform: "translateY(20px)",
              }}
            >
              {value}
            </ScalableElement>
          ))}
      </animated.div>
    </animated.li>
  );
};

export default Reason;
