import { useNavigate } from 'react-router-dom';
import { sendDataToDB } from '../../services/apiService';
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useWindowHeight } from "../../utils/tools";
import MoreOpen from "../../components/MoreOpen/MoreOpen";
import AddTransactionFeed from "../../transactionFeedPage/AddTransactionFeed";
import Notif from "./Notif/Notif";

import { useTransactions } from "../../context/TransactionContext";

const AddTransaction = () => {
  const { isAddClicked, setIsAddClicked, monthData } = useTransactions();
  // Alias for backward compatibility if needed, though mostly used as setIsClicked inside
  const setIsClicked = setIsAddClicked;
  useEffect(() => {
    !isAddClicked && setIsClicked("Income");
  }, []);

  const navigate = useNavigate();
  const pendingRecord = useRef(null);
  const saving = useRef(false);
  const [submitStatus, setSubmitStatus] = useState('');
  const confirmTransaction = async (confirmed) => {
    if (!confirmed || saving.current || !pendingRecord.current) return;
    saving.current = true;
    setSubmitStatus('Saving transaction…');
    const { id, ...record } = pendingRecord.current;
    try {
      const result = await sendDataToDB({ record_entry: record, record_type: record.Type });
      if (result?.status === 'error') throw new Error(result.message);
      await monthData.refresh();
      navigate('/');
    } catch (error) {
      setSubmitStatus(error.message || 'Could not save. Please retry.');
      setIsClicked(record.Category);
    } finally { saving.current = false; }
  };
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
    navigate("/");
    setAddTransaction({
      Amount: "",
      Category: "",
      Label: "",
      Reason: "",
      Timestamp: "",
      Type: "",
    });
  };
  const height = Math.max(Math.min(useWindowHeight(90), 480), 480);

  const AddFeed = useCallback(
    () => (
      <AddTransactionFeed
        isAddClicked={isAddClicked}
        setIsClicked={setIsAddClicked}
        setAddTransaction={(record) => { pendingRecord.current = record; setAddTransaction(record); }}
        addTransaction={addTransaction}
        setModify={setModify}
        setOpen={confirmTransaction}
      />
    ),
    [isAddClicked, addTransaction, monthData.refresh]
  );

  return (
    <>
      {submitStatus && <p role="status">{submitStatus}</p>}
      <MoreOpen
        isClicked={isAddClicked}
        setIsClicked={setIsAddClicked}
        feed={AddFeed}
        handleCloseAddTransaction={handleCloseAddTransaction}
        height={height}
        zIndex={110}
        toRedirect={undefined}
      />
      {/* <Notif
        addTransaction={addTransaction}
        setAddTransaction={setAddTransaction}
        modify={modify}
        setModify={setModify}
        open={open}
        setOpen={setOpen}
      /> */}
    </>
  );
};

export default AddTransaction;
