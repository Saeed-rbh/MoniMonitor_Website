import React, { useState, useCallback } from "react";
import { useWindowHeight } from "../Tools/tools";
import MoreOpen from "../Tools/MoreOpen";
import AddTransactionFeed from "../transactionFeedPage/AddTransactionFeed";
import Notif from "./Notif/Notif";

const AddTransaction = ({ isAddClicked, setIsAddClicked }) => {
  console.log(isAddClicked);

  const [modify, setModify] = useState(false);
  const [open, setOpen] = useState(false);
  const [addTransaction, setAddTransaction] = useState({
    Amount: "",
    Category: "",
    Label: "",
    Reason: "",
    Timestamp: "",
    Type: "",
  });
  const handleCloseAddTransaction = () => {
    setAddTransaction({
      Amount: "",
      Category: "",
      Label: "",
      Reason: "",
      Timestamp: "",
      Type: "",
    });
  };
  const height = useWindowHeight(100);

  const AddFeed = useCallback(
    () => (
      <AddTransactionFeed
        isAddClicked={isAddClicked}
        setIsClicked={setIsAddClicked}
        setAddTransaction={setAddTransaction}
        addTransaction={addTransaction}
        setModify={setModify}
        setOpen={setOpen}
      />
    ),
    [isAddClicked, addTransaction]
  );

  return (
    <>
      <MoreOpen
        isClicked={isAddClicked}
        setIsClicked={setIsAddClicked}
        feed={AddFeed}
        MoreOpenHeight={100}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        zIndex={110}
        toRedirect={"/"}
      />
      <Notif
        addTransaction={addTransaction}
        setAddTransaction={setAddTransaction}
        modify={modify}
        setModify={setModify}
        open={open}
        setOpen={setOpen}
      />
    </>
  );
};

export default AddTransaction;
