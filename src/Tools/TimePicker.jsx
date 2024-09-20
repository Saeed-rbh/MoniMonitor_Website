import React, { useEffect, useState } from "react";

const TimePicker = ({ setSelectedDate, selectedDate, submit, addStage }) => {
  const [hours, setHours] = useState(selectedDate.hours);
  const [minutes, setMinutes] = useState(selectedDate.minutes);
  const [blur, setBlur] = useState(true);

  useEffect(() => {
    setHours(selectedDate.hours);
    setMinutes(selectedDate.minutes);
  }, [selectedDate]);

  useEffect(() => {
    if (blur && hours.length === 2 && minutes.length === 2) {
      setSelectedDate({
        day: selectedDate.day,
        month: selectedDate.month,
        year: selectedDate.year,
        hours: hours,
        minutes: minutes,
        zone: selectedDate.zone,
      });
    }
  }, [hours, minutes, setSelectedDate, blur]);

  const parentStyle = {
    // border: "1px solid var(--Ac-3)",
    borderRadius: "18px",
    // padding: "5px",
    textAlign: "center",
    backgroundColor: "transparent",
    outline: "none",
    transition: "background-color 0.3s ease",
    caretColor: "transparent", // Hide caret
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--Ac-2)",
    // height: "100%",
    boxSizing: "border-box",
    aspectRatio: "1/1",
  };

  const inputStyle = {
    position: "relative",
    borderRadius: "7px",
    width: "auto",
    textAlign: "center",
    backgroundColor: "transparent",
    color: "var(--Ac-2)",
    outline: "none",
    transition: "background-color 0.3s ease",
    caretColor: "transparent", // Hide caret
    border: "none",
    // padding: "2px 4px",
    fontSize: "0.7rem",
    fontWeight: "400",
  };

  const inputFocusStyle = {
    backgroundColor: "var(--Ac-4)",
    color: "var(--Ac-1)",
  };

  const separatorStyle = {
    lineHeight: "40px",
    color: "var(--Bc-2)",
    width: "2px",
    justifyContent: "center",
    alignItems: "center",
    display: "flex",
  };

  const parentFocus = (e) => {
    e.currentTarget.style.backgroundColor = "var(--Ac-4)";
  };

  const parentBlur = (e) => {
    e.currentTarget.style.backgroundColor = "transparent";
  };

  const handleFocus = (e) => {
    setBlur(false);
    e.target.style.backgroundColor = "var(--Ec-1)";
    Object.assign(e.target.style, inputFocusStyle);
    selectContent(e.target);
  };

  const handleBlur = (e, setFunction, defaultValue, order) => {
    if (defaultValue.length < order) {
      setFunction(defaultValue.padStart(order, "0"));
    }

    e.target.style.backgroundColor = "transparent";
    if (e.target.innerText.trim() === "") {
      setFunction(defaultValue);
      e.target.innerText = defaultValue;
    }
    setBlur(true);
  };

  const selectContent = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const setCaretToEnd = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.target.blur();
    }
    if (/\D/.test(e.key) && e.key !== "Backspace") {
      e.preventDefault();
    }
  };

  const handleInput = (e, setFunction, min, max, length) => {
    const value = e.target.innerText.replace(/\D/g, "");
    const slicedValue = inputSlice(value, length, min, max);
    setFunction(slicedValue);
    e.target.innerText = slicedValue;
    setCaretToEnd(e.target);
  };

  const inputSlice = (value, order, min, max) => {
    const low = Math.floor(value.length / order) * order;
    const high = Math.ceil(value.length / order) * order;
    let sliced = "";
    if (low === high) {
      sliced = value.slice(low - order, high);
    } else {
      sliced = value.slice(low, high);
    }

    if (sliced[0] > max[0]) {
      sliced = sliced.padStart(order, "0");
    }

    if (sliced === "0" || sliced === "00") {
      sliced = min;
    }

    if (Number(sliced) > Number(max)) {
      sliced = max;
    }

    if (sliced.length < 0) {
      sliced = min;
    }

    return sliced;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "5px",
        height: "100%",
        maxHeight: 54,
        margin: "0 10px",
      }}
    >
      <div style={parentStyle} onFocus={parentFocus} onBlur={parentBlur}>
        <div
          contentEditable
          suppressContentEditableWarning
          onFocus={handleFocus}
          onBlur={(e) => handleBlur(e, setHours, hours, 2)}
          onKeyDown={(e) => handleKeyDown(e)}
          onInput={(e) => handleInput(e, setHours, "00", "23", 2)}
          style={inputStyle}
        >
          {hours}
        </div>
      </div>

      <span style={separatorStyle}>:</span>
      <div style={parentStyle} onFocus={parentFocus} onBlur={parentBlur}>
        <div
          contentEditable
          suppressContentEditableWarning
          onFocus={handleFocus}
          onBlur={(e) => handleBlur(e, setMinutes, minutes, 2)}
          onKeyDown={(e) => handleKeyDown(e)}
          onInput={(e) => handleInput(e, setMinutes, "01", "59", 2)}
          style={inputStyle}
        >
          {minutes}
        </div>
      </div>
    </div>
  );
};

export default TimePicker;
