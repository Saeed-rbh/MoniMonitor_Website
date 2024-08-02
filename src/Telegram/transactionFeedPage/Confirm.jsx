import React from "react";
import { ScalableElement } from "../tools";

const Confirm = ({ handleAddClick, whichType, setWhichType }) => {
  return (
    <li className="Add_Confirm">
      <ScalableElement as="h2" onClick={() => handleAddClick()}>
        Add Transaction
      </ScalableElement>
    </li>
  );
};

export default Confirm;
