import React, { useEffect, useState } from "react";
import { animated, useSpring } from "react-spring";
import { GoArrowUpRight, GoArrowDownLeft, GoPlus } from "react-icons/go";
import CircularProgressBar from "./CircularProgressBar";
import { ScalableElement } from "../../Tools/tools";
import { useDrag } from "@use-gesture/react";
import { FaXmark } from "react-icons/fa6";
import { FaCheck } from "react-icons/fa";

import { sendDataToDB, GetLabel, GetDataFromDB } from "../../Tools/apiService";

const Notif = ({
  addTransaction,
  setAddTransaction,
  modify,
  setModify,
  setOpen,
  open,
}) => {
  const [closeData, setCloseData] = useState([
    "Successfully Added",
    <FaCheck color="var(--Fc-1)" />,
  ]);
  const [deleted, setDeleted] = useState(false);

  const Amount = new Intl.NumberFormat().format(addTransaction.Amount);
  const Reason =
    addTransaction.Reason && addTransaction.Reason.length > 0
      ? addTransaction.Reason
      : "No Reason Provided";

  const Logo =
    addTransaction.Category === "Income" ? (
      <GoArrowDownLeft color="var(--Fc-2)" />
    ) : addTransaction.Category === "Expense" ? (
      <GoArrowUpRight color="var(--Gc-2)" />
    ) : (
      <GoPlus color="var(--Ac-2)" />
    );

  useEffect(() => {
    if (open && !deleted) {
      const timer = setTimeout(() => {
        setCloseData(["Successfully Added", <FaCheck color="var(--Fc-1)" />]);
        setDeleted(true);
        api.start({
          height: 55,
          border: "1px solid var(--Fc-2)",
        });
        setTimeout(() => {
          setOpen(false);
          setDeleted(false);
          api.start({
            y: -170,
            scale: 0.95,
            height: 150,
            border: "0px solid var(--Fc-2)",
            onRest: () => {
              handleFinish();
            },
          });
        }, 1500);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [open, setAddTransaction, deleted]);

  async function processTransaction(addTransaction) {
    let Label = addTransaction.Label;
    if (addTransaction.Reason.length > 0 && Label === "Auto Detect") {
      Label = await GetLabel({ record_entry: addTransaction });
    } else {
      Label = "other";
    }
    addTransaction.Label = Label;
    await sendDataToDB({ record_entry: addTransaction });
    setAddTransaction({
      Amount: 0,
      Category: "",
      Label: "Auto Detect",
      Reason: "",
      Timestamp: "",
      Type: "",
    });
    // const NewData = await GetDataFromDB();
  }

  const handleFinish = () => {
    processTransaction(addTransaction);
  };

  const [openStyle, api] = useSpring(() => ({
    scale: open ? 1 : 0.95,
    y: open ? 0 : -170,
    config: { tension: 200, friction: 35 },
    delay: !open ? 0 : 100,
    height: 150,
    border: "0px solid var(--Gc-2)",
    // onRest: !open ? handleFinish : null,
  }));

  useEffect(() => {
    open &&
      api.start({
        scale: 1,
        y: 0,
      });
  }, [open, api, handleFinish]);

  const bind = useDrag(
    ({
      movement: [, y],
      memo = false,
      last,
      velocity,
      initial: [, initialY],
    }) => {
      const isQuickDragUp = velocity[1] > 0.1 && y < initialY;

      if (y < 0) {
        if (last) {
          if (isQuickDragUp) {
            setCloseData([
              "Successfully Added",
              <FaCheck color="var(--Fc-1)" />,
            ]);
            setDeleted(true);
            api.start({
              height: 55,
              border: "1px solid var(--Fc-2)",
            });
            setTimeout(() => {
              setOpen(false);
              setDeleted(false);
              api.start({
                y: -170,
                scale: 0.95,
                height: 150,
                border: "0px solid var(--Fc-2)",
                onRest: () => {
                  handleFinish();
                },
              });
            }, 1500);
          }
        }
      }
      return memo;
    }
  );

  const HandleDelete = () => {
    setCloseData(["Transaction Deleted", <FaXmark color="var(--Gc-1)" />]);
    setDeleted(true);
    api.start({
      height: 55,
      border: "1px solid var(--Gc-2)",
    });
    setTimeout(() => {
      setOpen(false);
      setDeleted(false);
      api.start({
        y: -170,
        scale: 0.95,
        height: 150,
        border: "0px solid var(--Gc-2)",
      });
    }, 1500);
  };

  const HandleModify = () => {
    setModify(true);
    setOpen(false);
    api.start({
      scale: 0.95,
      y: -170,
    });
  };

  const CloseOpacityStyle = useSpring({
    opacity: !deleted ? (open ? 1 : 0) : 0,
    y: !deleted ? (open ? 0 : -20) : -10,
    delay: deleted ? 0 : 100,
  });

  const CloseInOpacityStyle = useSpring({
    opacity: deleted ? 1 : 0,
    y: deleted ? 0 : 50,
    delay: deleted ? 0 : 100,
  });

  return (
    <animated.div
      style={openStyle}
      className="addedTransactionNotif"
      {...bind()}
    >
      <animated.div className="Notif_Type" style={CloseOpacityStyle}>
        {Logo}
        <animated.div style={{ opacity: 0.4 }}></animated.div>
        <h1>
          <span>{addTransaction.Type}</span> {addTransaction.Category}
        </h1>
      </animated.div>
      <animated.div style={CloseOpacityStyle} className="Notif_Amount">
        <h1>Amount:</h1>
        <h2>${Amount}</h2>
      </animated.div>
      <animated.div style={CloseOpacityStyle} className="Notif_Reason">
        <h1>{addTransaction.Label}</h1>
        <h2>{Reason}</h2>
      </animated.div>
      <animated.div style={CloseOpacityStyle} className="Notif_Time">
        <h1>Date & Time:</h1>
        <h2>
          {addTransaction.Timestamp && addTransaction.Timestamp.split(" ")[0]}
          <span>
            {addTransaction.Timestamp && addTransaction.Timestamp.split(" ")[1]}
          </span>
        </h2>
      </animated.div>
      <animated.div style={CloseOpacityStyle} className="Notif_counter">
        {open && !deleted && (
          <CircularProgressBar
            key={open ? "open" : "closed"}
            pathColor="var(--Gc-2)"
            tailColor="var(--Ac-4)"
            valueStart={open ? 100 : 0}
            valueEnd={0}
          />
        )}
      </animated.div>
      <ScalableElement
        style={CloseOpacityStyle}
        as="div"
        className="Notif_Delete"
        onClick={HandleDelete}
      >
        <GoPlus color="var(--Ac-1)" />
        Delete
      </ScalableElement>
      <ScalableElement
        style={CloseOpacityStyle}
        as="div"
        className="Notif_Modify"
        onClick={HandleModify}
      >
        <GoPlus color="var(--Ac-1)" />
        Modify
      </ScalableElement>
      {deleted && (
        <animated.div style={CloseInOpacityStyle} className="Notif_Deleted">
          <span>{closeData[0]}</span>
          {closeData[1]}
        </animated.div>
      )}
    </animated.div>
  );
};

export default Notif;
