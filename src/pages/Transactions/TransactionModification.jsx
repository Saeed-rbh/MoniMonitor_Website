import React, { useState, useEffect } from "react";
import { useSpring, animated } from "@react-spring/web";
import { MdOutlineBrunchDining } from "react-icons/md";
import { FaCaretDown } from "react-icons/fa";
import { IoClose } from "react-icons/io5";

const transactions = [
  [
    {
      description: "Coffee",
      date: "Mar 30",
      time: "08:00 AM",
      amount: "4.50",
      Category: "Food",
    },
    {
      description: "York University",
      date: "Feb 3",
      time: "12:00 PM",
      amount: "12.00",
      Category: "Food",
    },
  ],
  [
    {
      description: "Coffee",
      date: "Mar 30",
      time: "08:00 AM",
      amount: "4.50",
      Category: "Food",
    },
    {
      description: "York University",
      date: "Feb 3",
      time: "12:00 PM",
      amount: "12.00",
      Category: "Food",
    },
  ],
];

const TransactionModification = ({
  transactionClick,
  handleTransactionUnClick,
  settransactionClickAnim,
  transactionClickAnim,
}) => {
  const halfHeightS = window.innerHeight / 2 - 170;
  const halfHeightE = halfHeightS + 0;

  const [categoryClick, setCategoryClick] = useState(false);

  const ClickOpacityStyle = useSpring({
    from: {
      opacity: transactionClickAnim ? 0 : 1,
      scale: transactionClickAnim ? 0.8 : 1,
      zIndex: 110,
    },
    to: {
      opacity: transactionClickAnim ? 1 : 0,
      scale: transactionClickAnim ? 1 : 0.8,
      zIndex: 110,
    },
  });

  const ClickBlurStyle = useSpring({
    from: {
      opacity: transactionClickAnim ? "0" : "1",
      position: "absolute",
      width: "calc(100% - 100px)",
      left: "15px",
      top: !transactionClickAnim ? halfHeightS : halfHeightE,
      // scale: transactionClickAnim ? 0.8 : 1,
      zIndex: 100,
    },
    to: {
      opacity: transactionClickAnim ? "1" : "0",
      // scale: transactionClickAnim ? 1 : 0.8,
      position: "absolute",
      width: "calc(100% - 100px)",
      left: "15px",
      top: transactionClickAnim ? halfHeightS : halfHeightE,
      zIndex: 100,
    },
    onRest: () => (transactionClickAnim ? "" : handleTransactionUnClick()),
  });

  const ClickCloseStyle = useSpring({
    from: {
      opacity: transactionClickAnim ? "0" : "1",
      top: !transactionClickAnim ? halfHeightS : halfHeightE,
      zIndex: 100,
    },
    to: {
      opacity: transactionClickAnim ? "1" : "0",
      top: transactionClickAnim ? halfHeightS : halfHeightE,
      zIndex: 100,
    },
  });

  const ClickModifyStyle = useSpring({
    from: {
      opacity: transactionClickAnim ? "0" : "1",
      top: !transactionClickAnim ? halfHeightS + 80 : halfHeightE + 80,
      // scale: transactionClickAnim ? 0.9 : 1.1,
      scale: 1.1,
    },
    to: {
      opacity: transactionClickAnim ? "1" : "0",
      // scale: transactionClickAnim ? 1.1 : 0.9,
      top: transactionClickAnim ? halfHeightS + 80 : halfHeightE + 80,
      scale: 1.1,
    },
  });

  const ClickTitleStyle = useSpring({
    from: {
      opacity: transactionClickAnim ? "0" : "1",
      top: !transactionClickAnim ? halfHeightS - 30 : halfHeightE - 30,
      // scale: transactionClickAnim ? 0.9 : 1.1,
    },
    to: {
      opacity: transactionClickAnim ? "1" : "0",
      // scale: transactionClickAnim ? 1.1 : 0.9,
      top: transactionClickAnim ? halfHeightS - 30 : halfHeightE - 30,
    },
  });

  const [inputValues, setInputValues] = useState({
    description: "",
    date: "",
    amount: "",
  });

  useEffect(() => {
    if (transactionClick[0] !== null && transactionClick[1] !== null) {
      const transaction =
        transactions[transactionClick[0]][transactionClick[1]];
      setInputValues({
        description: transaction.description,
        date: transaction.date,
        amount: transaction.amount,
      });
    }
  }, [transactionClick]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setInputValues((prevValues) => ({
      ...prevValues,
      [name]: value,
    }));
  };

  const handleInputBlur = () => {
    const updatedTransactions = [...transactions];
    updatedTransactions[transactionClick[0]][transactionClick[1]] = {
      ...inputValues,
    };
  };

  return (
    <>
      {/* {categoryClick && (
        <ModifyCategory
          categoryClick={categoryClick}
          halfHeightS={halfHeightS}
          halfHeightE={halfHeightE}
          setCategoryClick={setCategoryClick}
        />
      )} */}
      <animated.div
        className="TransactionModification"
        style={ClickOpacityStyle}
      >
        <animated.div
          className="TransactionModification_Close"
          style={ClickCloseStyle}
          onClick={() => settransactionClickAnim(false)}
        >
          <IoClose />
        </animated.div>
        <animated.h1 style={ClickTitleStyle}>
          {" "}
          Transaction to<span>Modify</span> :
        </animated.h1>
        <animated.div
          className="TransactionList_TransactionList"
          style={ClickBlurStyle}
        >
          <animated.li>
            <animated.p>
              <animated.span>
                <MdOutlineBrunchDining />
              </animated.span>
              {
                transactions[transactionClick[0]][transactionClick[1]]
                  .description
              }
            </animated.p>
            <animated.p>
              <span>
                {transactions[transactionClick[0]][transactionClick[1]].date}
              </span>
              <animated.span>
                • {transactions[transactionClick[0]][transactionClick[1]].time}
              </animated.span>
            </animated.p>
            <animated.p>
              ${transactions[transactionClick[0]][transactionClick[1]].amount}
            </animated.p>
          </animated.li>
        </animated.div>
        <animated.div
          className="TransactionModification_Modify"
          style={ClickModifyStyle}
        >
          <div className="TransactionModification_ModifyR1">
            <p>
              <span>Description:</span>
              <span>
                <input
                  type="text"
                  name="description"
                  value={inputValues.description}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                />
              </span>
            </p>
            <p>
              <span>Amount:</span>
              <span>
                <input
                  type="text"
                  name="amount"
                  value={inputValues.amount}
                  onChange={handleInputChange}
                  onBlur={handleInputBlur}
                />
              </span>
            </p>
          </div>
          <div className="TransactionModification_ModifyR2">
            <p onClick={() => setCategoryClick(true)}>
              <span>Category:</span>
              <span>
                <MdOutlineBrunchDining />
                {
                  transactions[transactionClick[0]][transactionClick[1]]
                    .Category
                }
                <FaCaretDown />
              </span>
            </p>
            <p>
              <span>Date:</span>
              <span>
                <MdOutlineBrunchDining />
                {transactions[transactionClick[0]][transactionClick[1]].date}
                <FaCaretDown />
              </span>
            </p>
          </div>
        </animated.div>
      </animated.div>
    </>
  );
};

export default TransactionModification;
