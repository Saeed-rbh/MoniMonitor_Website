// import React, { useEffect, useState } from "react";

// const DatePicker = ({ setSelectedDate, selectedDate }) => {
//   const currentYear = new Date().getFullYear();
//   const minYear = 2000;
//   const maxYear = currentYear + 5;

//   // Default state where day is preselected, year and month are dynamic
//   const [year, setYear] = useState(selectedDate.year);
//   const [month, setMonth] = useState(selectedDate.month);
//   const [day, setDay] = useState(selectedDate.day);

//   const [blur, setBlur] = useState(true);

//   useEffect(() => {
//     setMonth(selectedDate.month);
//     setYear(selectedDate.year);
//     setDay(selectedDate.day);
//   }, [selectedDate]);

//   useEffect(() => {
//     if (blur && month.length === 2 && year.length === 4) {
//       const daysInCurrentMonth = daysInMonth(Number(month), Number(year));
//       if (Number(day) > daysInCurrentMonth) {
//         setDay(daysInCurrentMonth.toString().padStart(2, "0"));
//       }
//       setSelectedDate((prevDate) => ({
//         day:
//           Number(day) > daysInCurrentMonth
//             ? daysInCurrentMonth.toString().padStart(2, "0")
//             : day,
//         month: month,
//         year: year,
//         hours: prevDate.hours,
//         minutes: prevDate.minutes,
//         zone: prevDate.zone,
//       }));
//     }
//   }, [month, year, day, blur, setSelectedDate]);

//   const parentStyle = {
//     borderRadius: "18px",
//     textAlign: "center",
//     backgroundColor: "transparent",
//     outline: "none",
//     transition: "background-color 0.3s ease",
//     caretColor: "auto", // Show caret for typing
//     display: "flex",
//     alignItems: "center",
//     justifyContent: "center",
//     color: "var(--Ac-2)",
//     boxSizing: "border-box",
//     aspectRatio: "1 / 1",
//   };

//   const inputStyle = {
//     position: "relative",
//     borderRadius: "7px",
//     width: "auto",
//     textAlign: "center",
//     backgroundColor: "transparent",
//     color: "var(--Ac-2)",
//     outline: "none",
//     transition: "background-color 0.3s ease",
//     caretColor: "auto", // Show caret for typing
//     border: "none",
//     fontSize: "0.7rem",
//     fontWeight: "400",
//     padding: "5px",
//     margin: "0 -3px",
//   };

//   const inputFocusStyle = {
//     // backgroundColor: "var(--Ac-4)",
//     color: "var(--Ac-1)",
//   };

//   const separatorStyle = {
//     lineHeight: "40px",
//     color: "var(--Bc-1)",
//     fontSize: "0.7rem",
//     fontWeight: "400",
//     width: "2px",
//     justifyContent: "center",
//     alignItems: "center",
//     display: "flex",
//   };

//   const parentFocus = (e) => {
//     // e.currentTarget.style.backgroundColor = "var(--Ac-4)";
//   };

//   const parentBlur = (e) => {
//     e.currentTarget.style.backgroundColor = "transparent";
//   };

//   const handleFocus = (e) => {
//     setBlur(false);
//     e.target.style.backgroundColor = "var(--Ac-4)";
//     Object.assign(e.target.style, inputFocusStyle);
//     selectContent(e.target);
//   };

//   const handleBlur = (e, setFunction, defaultValue, order, min, max) => {
//     let value = e.target.innerText.trim();
//     if (value.length < order) {
//       value = value.padStart(order, "0");
//     }
//     // Ensure the value is within the min and max range
//     if (Number(value) < Number(min)) {
//       value = min;
//     } else if (Number(value) > Number(max)) {
//       value = max;
//     }

//     setFunction(value);
//     e.target.innerText = value;
//     e.target.style.backgroundColor = "transparent";
//     setBlur(true);
//     setSelectedDate((prevDate) => {
//       const daysInCurrentMonth = daysInMonth(Number(month), Number(year));
//       const newDay =
//         Number(day) > daysInCurrentMonth
//           ? daysInCurrentMonth.toString().padStart(2, "0")
//           : day;
//       return {
//         day: newDay,
//         month,
//         year,
//         hours: prevDate.hours,
//         minutes: prevDate.minutes,
//         zone: prevDate.zone,
//       };
//     });
//   };

//   const selectContent = (element) => {
//     const range = document.createRange();
//     range.selectNodeContents(element);
//     const sel = window.getSelection();
//     sel.removeAllRanges();
//     sel.addRange(range);
//   };

//   const setCaretToEnd = (el) => {
//     const range = document.createRange();
//     range.selectNodeContents(el);
//     range.collapse(false);
//     const sel = window.getSelection();
//     sel.removeAllRanges();
//     sel.addRange(range);
//   };

//   const handleKeyDown = (e) => {
//     if (e.key === "Enter" || e.key === "Tab") {
//       e.preventDefault();
//       e.target.blur();
//     }
//     if (/\D/.test(e.key) && e.key !== "Backspace") {
//       e.preventDefault();
//     }
//   };

//   const handleInput = (e, setFunction, min, max, length) => {
//     const value = e.target.innerText.replace(/\D/g, "");
//     if (value.length <= length) {
//       setFunction(value);
//       e.target.innerText = value;
//       setCaretToEnd(e.target);
//     }
//   };

//   const inputSlice = (value, order, min, max) => {
//     let sliced = value.slice(0, order);
//     if (Number(sliced) < Number(min)) {
//       sliced = min;
//     } else if (Number(sliced) > Number(max)) {
//       sliced = max;
//     }
//     return sliced;
//   };

//   const daysInMonth = (month, year) => {
//     return new Date(year, month, 0).getDate();
//   };

//   return (
//     <div
//       style={{
//         display: "flex",
//         alignItems: "center",
//         gap: "3px",
//         height: "100%",
//         maxHeight: 54,
//         margin: "0 7px",
//       }}
//     >
//       <div style={parentStyle} onFocus={parentFocus} onBlur={parentBlur}>
//         <div
//           contentEditable
//           suppressContentEditableWarning
//           onFocus={handleFocus}
//           onBlur={(e) =>
//             handleBlur(
//               e,
//               setDay,
//               day,
//               2,
//               "01",
//               daysInMonth(Number(month), Number(year))
//                 .toString()
//                 .padStart(2, "0")
//             )
//           }
//           onKeyDown={(e) => handleKeyDown(e)}
//           onInput={(e) => {
//             const value = e.target.innerText.replace(/\D/g, "");
//             if (value.length <= 2) {
//               setDay(value);
//               e.target.innerText = value;
//               setCaretToEnd(e.target);
//             }
//           }}
//           style={inputStyle}
//         >
//           {day}
//         </div>
//       </div>
//       <span style={separatorStyle}>/</span>
//       <div style={parentStyle} onFocus={parentFocus} onBlur={parentBlur}>
//         <div
//           contentEditable
//           suppressContentEditableWarning
//           onFocus={handleFocus}
//           onBlur={(e) => handleBlur(e, setMonth, month, 2, "01", "12")}
//           onKeyDown={(e) => handleKeyDown(e)}
//           onInput={(e) => {
//             const value = e.target.innerText.replace(/\D/g, "");
//             if (value.length <= 2) {
//               setMonth(value);
//               e.target.innerText = value;
//               setCaretToEnd(e.target);
//             }
//           }}
//           style={inputStyle}
//         >
//           {month}
//         </div>
//       </div>
//       <span style={separatorStyle}>/</span>
//       <div style={{ ...parentStyle }} onFocus={parentFocus} onBlur={parentBlur}>
//         <div
//           contentEditable
//           suppressContentEditableWarning
//           onFocus={handleFocus}
//           onBlur={(e) => handleBlur(e, setYear, year, 4, minYear, maxYear)}
//           onKeyDown={(e) => handleKeyDown(e)}
//           onInput={(e) => {
//             const value = e.target.innerText.replace(/\D/g, "");
//             if (value.length <= 4) {
//               setYear(value);
//               e.target.innerText = value;
//               setCaretToEnd(e.target);
//             }
//           }}
//           style={inputStyle}
//         >
//           {year}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default DatePicker;
import React, { useEffect, useState } from "react";

const DatePicker = ({ setSelectedDate, selectedDate }) => {
  const currentYear = new Date().getFullYear();
  const minYear = 2000;
  const maxYear = currentYear + 5;

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
      const daysInCurrentMonth = daysInMonth(Number(month), Number(year));
      if (Number(day) > daysInCurrentMonth) {
        setDay(daysInCurrentMonth.toString().padStart(2, "0"));
      }
      setSelectedDate((prevDate) => ({
        day:
          Number(day) > daysInCurrentMonth
            ? daysInCurrentMonth.toString().padStart(2, "0")
            : day,
        month: month,
        year: validateYear(year),
        hours: prevDate.hours,
        minutes: prevDate.minutes,
        zone: prevDate.zone,
      }));
    }
  }, [month, year, day, blur, setSelectedDate]);

  const validateYear = (year) => {
    const numericYear = Number(year);
    if (numericYear < minYear) {
      return minYear.toString();
    } else if (numericYear > maxYear) {
      return maxYear.toString();
    }
    return year;
  };

  const parentStyle = {
    borderRadius: "18px",
    textAlign: "center",
    backgroundColor: "transparent",
    outline: "none",
    transition: "background-color 0.3s ease",
    caretColor: "auto", // Show caret for typing
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--Ac-2)",
    boxSizing: "border-box",
    aspectRatio: "1 / 1",
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
    caretColor: "auto", // Show caret for typing
    border: "none",
    fontSize: "0.7rem",
    fontWeight: "400",
    padding: "5px",
    margin: "0 -3px",
  };

  const inputFocusStyle = {
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
    // e.currentTarget.style.backgroundColor = "var(--Ac-4)";
  };

  const parentBlur = (e) => {
    e.currentTarget.style.backgroundColor = "transparent";
  };

  const handleFocus = (e) => {
    setBlur(false);
    e.target.style.backgroundColor = "var(--Ac-4)";
    Object.assign(e.target.style, inputFocusStyle);
    selectContent(e.target);
  };

  const handleBlur = (e, setFunction, defaultValue, order, min, max) => {
    let value = e.target.innerText.trim();
    if (value.length < order) {
      value = value.padStart(order, "0");
    }
    // Ensure the value is within the min and max range
    if (Number(value) < Number(min)) {
      value = min;
    } else if (Number(value) > Number(max)) {
      value = max;
    }

    setFunction(value);
    e.target.innerText = value;
    e.target.style.backgroundColor = "transparent";
    setBlur(true);
    setSelectedDate((prevDate) => {
      const daysInCurrentMonth = daysInMonth(Number(month), Number(year));
      const newDay =
        Number(day) > daysInCurrentMonth
          ? daysInCurrentMonth.toString().padStart(2, "0")
          : day;
      return {
        day: newDay,
        month,
        year: validateYear(year),
        hours: prevDate.hours,
        minutes: prevDate.minutes,
        zone: prevDate.zone,
      };
    });
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
    let value = e.target.innerText.replace(/\D/g, "");
    if (value.length <= length) {
      setFunction(value);
      e.target.innerText = value;
      setCaretToEnd(e.target);
    }
  };

  const daysInMonth = (month, year) => {
    return new Date(year, month, 0).getDate();
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
          onBlur={(e) =>
            handleBlur(
              e,
              setDay,
              day,
              2,
              "01",
              daysInMonth(Number(month), Number(year))
                .toString()
                .padStart(2, "0")
            )
          }
          onKeyDown={(e) => handleKeyDown(e)}
          onInput={(e) => {
            const value = e.target.innerText.replace(/\D/g, "");
            if (value.length <= 2) {
              setDay(value);
              e.target.innerText = value;
              setCaretToEnd(e.target);
            }
          }}
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
          onBlur={(e) => handleBlur(e, setMonth, month, 2, "01", "12")}
          onKeyDown={(e) => handleKeyDown(e)}
          onInput={(e) => {
            const value = e.target.innerText.replace(/\D/g, "");
            if (value.length <= 2) {
              setMonth(value);
              e.target.innerText = value;
              setCaretToEnd(e.target);
            }
          }}
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
          onBlur={(e) =>
            handleBlur(
              e,
              setYear,
              year,
              4,
              minYear.toString(),
              maxYear.toString()
            )
          }
          onKeyDown={(e) => handleKeyDown(e)}
          onInput={(e) => {
            let value = e.target.innerText.replace(/\D/g, "");
            if (value.length <= 4) {
              setYear(value);
              e.target.innerText = value;
              setCaretToEnd(e.target);
            }
          }}
          style={inputStyle}
        >
          {year}
        </div>
      </div>
    </div>
  );
};

export default DatePicker;
