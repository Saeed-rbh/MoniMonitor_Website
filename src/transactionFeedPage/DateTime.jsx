import React, { useEffect, useState } from "react";

const DateTime = ({
  currentTime,
  hour,
  minute,
  day,
  month,
  year,
  defaultValue,
}) => {
  const Modify = defaultValue.length > 0;
  const getBorderStyle = (isValid) =>
    isValid ? {} : { border: "1px solid var(--Gc-2)" };

  const [ModifiedTime, setModifiedTime] = useState([
    false,
    false,
    false,
    false,
    false,
  ]);
  useEffect(() => {
    if (!ModifiedTime[0] && hour.value.length > 0) {
      hour.setIsValid(true);
      setModifiedTime([
        true,
        ModifiedTime[1],
        ModifiedTime[2],
        ModifiedTime[3],
      ]);
    }
    if (!ModifiedTime[1] && minute.value.length > 0) {
      minute.setIsValid(true);
      setModifiedTime([
        ModifiedTime[0],
        true,
        ModifiedTime[2],
        ModifiedTime[3],
      ]);
    }
    if (!ModifiedTime[2] && day.value.length > 0) {
      day.setIsValid(true);
      setModifiedTime([
        ModifiedTime[0],
        ModifiedTime[1],
        true,
        ModifiedTime[3],
      ]);
    }
    if (!ModifiedTime[3] && month.value.length > 0) {
      month.setIsValid(true);
      setModifiedTime([
        ModifiedTime[0],
        ModifiedTime[1],
        ModifiedTime[2],
        true,
      ]);
    }
    if (!ModifiedTime[4] && year.value.length > 0) {
      year.setIsValid(true);
      setModifiedTime([
        ModifiedTime[0],
        ModifiedTime[1],
        ModifiedTime[2],
        ModifiedTime[3],
        true,
      ]);
    }
  }, [currentTime]);

  return (
    <li className="Add_DateTime">
      <h1>
        <p>
          • Time <span></span>
        </p>
        <textarea
          type="text"
          maxLength="2"
          inputMode="numeric"
          placeholder={currentTime.hours}
          value={
            ModifiedTime[0] || !Modify
              ? hour.value
              : defaultValue.split(" ")[1].split(":")[0]
          }
          onChange={hour.handleChange}
          // onBlur={hour.handleBlur}
          style={getBorderStyle(hour.isValid)}
          defaultValue={Modify ? defaultValue.split(" ")[1].split(":")[0] : ""}
        />
        :
        <textarea
          type="text"
          maxLength="2"
          inputMode="numeric"
          placeholder={currentTime.minutes}
          value={
            ModifiedTime[1] || !Modify
              ? minute.value
              : defaultValue.split(" ")[1].split(":")[1]
          }
          onChange={minute.handleChange}
          onBlur={minute.handleBlur}
          style={getBorderStyle(minute.isValid)}
          defaultValue={Modify ? defaultValue.split(" ")[1].split(":")[1] : ""}
        />
      </h1>
      <h1>
        <p>
          • Date <span></span>
        </p>
        <textarea
          type="text"
          maxLength="2"
          inputMode="numeric"
          placeholder={currentTime.day}
          value={
            ModifiedTime[2] || !Modify
              ? day.value
              : defaultValue.split(" ")[0].split("-")[2]
          }
          onChange={day.handleChange}
          onBlur={day.handleBlur}
          style={getBorderStyle(day.isValid)}
          defaultValue={Modify ? defaultValue.split(" ")[0].split("-")[2] : ""}
        />
        /
        <textarea
          type="text"
          maxLength="2"
          inputMode="numeric"
          placeholder={currentTime.month}
          value={
            ModifiedTime[3] || !Modify
              ? month.value
              : defaultValue.split(" ")[0].split("-")[1]
          }
          onChange={month.handleChange}
          onBlur={month.handleBlur}
          style={getBorderStyle(month.isValid)}
          defaultValue={Modify ? defaultValue.split(" ")[0].split("-")[1] : ""}
        />
        /
        <textarea
          type="text"
          maxLength="4"
          inputMode="numeric"
          placeholder={currentTime.year}
          value={
            ModifiedTime[4] || !Modify
              ? year.value
              : defaultValue.split(" ")[0].split("-")[0]
          }
          onChange={year.handleChange}
          onBlur={year.handleBlur}
          style={getBorderStyle(year.isValid)}
          defaultValue={Modify ? defaultValue.split(" ")[0].split("-")[0] : ""}
        />
      </h1>
    </li>
  );
};

export default DateTime;
