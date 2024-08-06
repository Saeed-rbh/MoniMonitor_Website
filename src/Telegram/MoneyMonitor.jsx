import React, { useEffect, useState, useMemo } from "react";
import "./MoneyMonitor.css";
// import MenuButton from "../Header/MenuButton";
import MoneyEntry from "./MoneyEntry";
import TransactionList from "./TransactionList";
import { a, animated, useSpring } from "react-spring";
import { fetchTransactions } from "../Tools/transactionService";
import MainStatestics from "./MainStatestics";
import { useWindowHeight } from "../Tools/tools";
import AddTransaction from "./AddTransaction";
import MoreOpen from "../Tools/MoreOpen";
// import AddTransactionFeed from "./transactionFeedPage/AddTransactionFeed";
import Notif from "./addedTransactionNotif/Notif";
import axios from "axios";

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

const MoneyMonitor = ({ isMoreClicked, setIsMoreClicked }) => {
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

  const [isAddClicked, setIsAddClicked] = useState(null);

  useEffect(() => {
    !isMoreClicked && setWhichMonth(mainPageMonth);
  }, [isMoreClicked, mainPageMonth]);

  const scaleStyle = useSpring({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    scale: isMoreClicked || isAddClicked !== null ? 0.9 : 1,
    opacity: isMoreClicked || isAddClicked !== null ? 0.5 : 1,
    filter: isMoreClicked || isAddClicked !== null ? "blur(10px)" : "blur(0px)",
  });

  const [addTransaction, setAddTransaction] = useState({
    Amount: "",
    Category: "",
    Label: "",
    Reason: "",
    Timestamp: "",
    Type: "",
  });
  // const handleCloseAddTransaction = () => {
  //   setAddTransaction({
  //     Amount: "",
  //     Category: "",
  //     Label: "",
  //     Reason: "",
  //     Timestamp: "",
  //     Type: "",
  //   });
  // };

  // const AddFeed = () => {
  //   return (
  //     <AddTransactionFeed
  //       isAddClicked={isAddClicked}
  //       setIsClicked={setIsAddClicked}
  //       setAddTransaction={setAddTransaction}
  //       addTransaction={addTransaction}
  //       setModify={setModify}
  //       setOpen={setOpen}
  //     />
  //   );
  // };

  const TransactionFeed = () => {
    return (
      <TransactionList
        Transactions={transactionsData}
        selectedData={selectedData}
        isMoreClicked={isMoreClicked}
        setIsMoreClicked={setIsMoreClicked}
        setWhichMonth={setWhichMonth}
        whichMonth={whichMonth}
        dataAvailability={availabilityData}
        setIsAddClicked={setIsAddClicked}
        setAddTransaction={setAddTransaction}
      />
    );
  };

  const [modify, setModify] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (modify) {
      setIsAddClicked(addTransaction.Category);
    }
  }, [modify]);

  return (
    <>
      {/* <MoreOpen
        isClicked={isAddClicked}
        setIsClicked={setIsAddClicked}
        feed={AddFeed}
        MoreOpenHeight={100}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        zIndex={110}
      />
      <MoreOpen
        isClicked={isMoreClicked}
        setIsClicked={setIsMoreClicked}
        feed={TransactionFeed}
        MoreOpenHeight={100}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        blur={isAddClicked}
      /> */}

      <div className="MoneyMonitor_Parent">
        {/* <Notif
          addTransaction={addTransaction}
          setAddTransaction={setAddTransaction}
          modify={modify}
          setModify={setModify}
          open={open}
          setOpen={setOpen}
        /> */}

        <animated.div style={scaleStyle}>
          <AddTransaction setIsAddClicked={setIsAddClicked} />
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
