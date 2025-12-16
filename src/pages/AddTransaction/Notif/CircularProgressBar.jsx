import React from "react";
import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import { easeLinear } from "d3-ease";
import AnimatedProgressProvider from "./AnimatedProgressProvider";

const CircularProgressBar = ({
  valueStart,
  valueEnd,
  pathColor,
  tailColor,
}) => {
  const [progress, setProgress] = React.useState(valueStart);

  React.useEffect(() => {
    setInterval(() => {
      setProgress((prevProgress) =>
        prevProgress <= valueEnd ? valueStart : prevProgress - 1
      );
    }, 1);
  }, []);

  return (
    <AnimatedProgressProvider
      valueStart={valueStart}
      valueEnd={valueEnd}
      duration={5}
      easingFunction={easeLinear}
    >
      {(value) => {
        const roundedValue = Math.ceil(value / 20);

        return (
          <CircularProgressbar
            value={value}
            text={`${roundedValue}s`}
            strokeWidth={value / 25 + 5}
            styles={buildStyles({
              pathTransition: "none",
              textSize: "30px",
              textWeight: "100",
              pathColor: pathColor,
              textColor: "var(--Ac-1)",
              trailColor: tailColor,
              backgroundColor: "var(--Ec-4)",
            })}
          />
        );
      }}
    </AnimatedProgressProvider>
  );
};

export default CircularProgressBar;
