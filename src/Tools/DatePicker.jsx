import React, { useEffect, useState } from "react";

const DatePicker = ({ minDate, maxDate, setSelectedDate, selectedDate }) => {
  // Default state where day is preselected, year and month are dynamic
  const [year, setYear] = useState(selectedDate.year);
  const [month, setMonth] = useState(selectedDate.month);
  const [day, setDay] = useState(selectedDate.day);

  const [blur, setBlur] = useState(true);

  useEffect(() => {
    setMonth(selectedDate.month);
    setYear(selectedDate.year);
    setDay(selectedDate.day);
  }, [selectedDate]);

  useEffect(() => {
    if (blur && month.length === 2 && year.length === 4) {
      setSelectedDate({
        day: day,
        month: month,
        year: year,
        hours: selectedDate.hours,
        minutes: selectedDate.minutes,
        zone: selectedDate.zone,
      });
    }
  }, [month, year, setSelectedDate, blur]);

  const parentStyle = {
    borderRadius: "18px",
    textAlign: "center",
    backgroundColor: "transparent",
    outline: "none",
    transition: "background-color 0.3s ease",
    caretColor: "transparent", // Hide caret
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--Ac-2)",
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
    fontSize: "0.7rem",
    fontWeight: "400",
  };

  const inputFocusStyle = {
    backgroundColor: "var(--Ac-4)",
    color: "var(--Ac-1)",
  };

  const separatorStyle = {
    lineHeight: "40px",
    color: "var(--Bc-1)",
    fontSize: "0.7rem",
    fontWeight: "400",
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
    // Set default value if input is empty
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

    if (sliced[0] > max[0] && Number(min) === 1) {
      sliced = sliced.padStart(order, "0");
    }

    if (Number(min) !== 1) {
      for (let i = 0; i <= 3; i++) {
        if (Number(sliced.slice(0, i + 1)) > Number(max.slice(0, i + 1))) {
          sliced = max;
          break;
        }
      }
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
        gap: "3px",
        height: "100%",
        maxHeight: 54,
        margin: "0 7px",
      }}
    >
      <div style={parentStyle} onFocus={parentFocus} onBlur={parentBlur}>
        <div
          contentEditable
          suppressContentEditableWarning
          onFocus={handleFocus}
          onBlur={(e) => handleBlur(e, setMonth, month, 2)}
          onKeyDown={(e) => handleKeyDown(e)}
          onInput={(e) => handleInput(e, setMonth, "01", "12", 2)}
          style={inputStyle}
        >
          {day}
        </div>
      </div>
      <span style={separatorStyle}>/</span>
      <div style={parentStyle} onFocus={parentFocus} onBlur={parentBlur}>
        <div
          contentEditable
          suppressContentEditableWarning
          onFocus={handleFocus}
          onBlur={(e) => handleBlur(e, setMonth, month, 2)}
          onKeyDown={(e) => handleKeyDown(e)}
          onInput={(e) => handleInput(e, setMonth, "01", "12", 2)}
          style={inputStyle}
        >
          {month}
        </div>
      </div>
      <span style={separatorStyle}>/</span>
      <div style={{ ...parentStyle }} onFocus={parentFocus} onBlur={parentBlur}>
        <div
          contentEditable
          suppressContentEditableWarning
          onFocus={handleFocus}
          onBlur={(e) => handleBlur(e, setYear, year, 4)}
          onKeyDown={(e) => handleKeyDown(e)}
          onInput={(e) =>
            handleInput(
              e,
              setYear,
              minDate?.year ? minDate.year : "1900",
              maxDate.year,
              4
            )
          }
          style={inputStyle}
        >
          {year}
        </div>
      </div>
    </div>
  );
};

export default DatePicker;
