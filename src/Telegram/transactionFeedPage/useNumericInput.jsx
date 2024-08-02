import { useState, useCallback } from "react";

export const useNumericInput = (
  initialValue,
  min,
  max,
  shouldWaitForCompleteInput = false
) => {
  const [value, setValue] = useState(initialValue);

  const [isValid, setIsValid] = useState(true);

  const handleChange = useCallback(
    (event) => {
      const numericValue = event.target.value.replace(/[^0-9]/g, "");
      setValue(numericValue);

      if (shouldWaitForCompleteInput && numericValue.length < 4) {
        setIsValid(true);
      } else {
        if (
          numericValue === "" ||
          (parseInt(numericValue, 10) >= min &&
            parseInt(numericValue, 10) <= max)
        ) {
          setIsValid(true);
        } else {
          setIsValid(false);
        }
      }
    },
    [min, max, shouldWaitForCompleteInput]
  );

  const handleBlur = useCallback(() => {
    let numericValue =
      value === ""
        ? ""
        : Math.max(min, Math.min(max, parseInt(value, 10))).toString();
    setValue(numericValue);

    if (shouldWaitForCompleteInput && value.length < 4) {
      setIsValid(true);
    } else {
      if (
        value !== "" &&
        (parseInt(value, 10) < min || parseInt(value, 10) > max)
      ) {
        setIsValid(false);
      } else {
        setIsValid(true);
      }
    }
  }, [value, min, max, shouldWaitForCompleteInput]);

  return [
    {
      value: value,
      handleChange: handleChange,
      handleBlur: handleBlur,
      isValid: isValid,
    },
  ];
};
