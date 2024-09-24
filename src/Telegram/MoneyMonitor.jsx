import React, { useEffect, useState } from "react";
import "./MoneyMonitor.css";
import MoneyEntry from "./MoneyEntry";
import { animated, useSpring } from "react-spring";
import { fetchTransactions } from "../Tools/transactionService";
import MainStatestics from "./MainStatestics";
import { useWindowHeight } from "../Tools/tools";
import AddTransaction from "./AddTransaction";

const useTransactionData = (whichMonth) => {
  const [data, setData] = useState({
    selected: [],
    Availability: [],
    netAmounts: [],
  });

  useEffect(() => {
    const fetchData = async () => {
      const { selected, Availability, netAmounts, transactions } =
        await fetchTransactions({
          whichMonth,
        });

      setData({
        selected: selected,
        Availability: Availability,
        transactions: transactions,
        netAmounts: netAmounts,
      });
    };
    fetchData();
  }, [whichMonth]);

  return data;
};

const useMainPageMonth = () => {
  const [mainPageMonth, setMainPageMonth] = useState(0);
  return { mainPageMonth, setMainPageMonth };
};

const MoneyMonitor = ({
  isDateClicked,
  isMoreClicked,
  setIsMoreClicked,
  isAddClicked,
  setIsAddClicked,
}) => {
  const height = useWindowHeight(100);
  const [whichMonth, setWhichMonth] = useState(0);

  const {
    selected: selectedData,
    Availability: availabilityData,
    netAmounts: netAmountsData,
    transactions: transactionsData,
  } = useTransactionData(whichMonth);

  const { mainPageMonth, setMainPageMonth } = useMainPageMonth();
  const { selected: mainSelected } = useTransactionData(mainPageMonth);

  useEffect(() => {
    !isMoreClicked && setWhichMonth(mainPageMonth);
  }, [isMoreClicked, mainPageMonth]);

  const scaleStyle = useSpring({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    scale: isDateClicked || isMoreClicked || isAddClicked !== null ? 0.9 : 1,
    opacity: isDateClicked || isMoreClicked || isAddClicked !== null ? 0.5 : 1,
    filter:
      isDateClicked || isMoreClicked || isAddClicked !== null
        ? "blur(10px)"
        : "blur(0px)",
  });

  const [addTransaction, setAddTransaction] = useState({
    Amount: "",
    Category: "",
    Label: "",
    Reason: "",
    Timestamp: "",
    Type: "",
  });

  const [modify, setModify] = useState(false);

  useEffect(() => {
    if (modify) {
      setIsAddClicked(addTransaction.Category);
    }
  }, [modify]);

  return (
    <>
      <div className="MoneyMonitor_Parent">
        <animated.div style={scaleStyle}>
          {/* <AddTransaction setIsAddClicked={setIsAddClicked} /> */}
          <MainStatestics
            height={height}
            netAmounts={netAmountsData}
            mainPageMonth={mainPageMonth}
            setMainPageMonth={setMainPageMonth}
          />
          {Object.keys(mainSelected).length > 0 && (
            <MoneyEntry
              setIsMoreClicked={setIsMoreClicked}
              Transactions={mainSelected}
            />
          )}
        </animated.div>
      </div>
    </>
  );
};

export default MoneyMonitor;
