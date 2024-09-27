import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { useSpring, animated } from "react-spring";
import { FaCheck } from "react-icons/fa";
import { FaXmark } from "react-icons/fa6";
import { ScalableElement } from "../Tools/tools";
import { MdModeEditOutline } from "react-icons/md";

const AmountLogo = ({ Animate1, Animate2, style1, style2, fontColor }) => {
  const Style = useSpring({
    position: "absolute",
    top: 35,
  });
  return (
    <animated.div style={Style} className="AddTransactionFeed_AmountLogo">
      {Animate1 && (
        <animated.div style={style1} className="AddTransactionFeed_Logo">
          <FaXmark color={fontColor} />
        </animated.div>
      )}
      {Animate2 && (
        <animated.div style={style2} className="AddTransactionFeed_Logo">
          <FaCheck color={fontColor} />
        </animated.div>
      )}
    </animated.div>
  );
};

const Amount = ({
  value,
  setValue,
  valueError,
  setValueError,
  defaultValue,
  whichType,
  setWhichType,
  isLongPress,
  addStage,
  setAddStage,
  isAddClicked,
}) => {
  const fade = useSpring({
    from: {
      filter: isLongPress ? "blur(0px)" : "blur(10px)",
      // opacity: addStage !== 0 ? 0 : 1,
      top: addStage !== 0 ? "55px" : "35px",
      position: "absolute",
      borderRadius: 0,
    },
    to: {
      filter:
        addStage < 1 ? "blur(10px)" : isLongPress ? "blur(10px)" : "blur(0px)",
      // opacity: addStage !== 0 ? 1 : 0,
      top: addStage > 1 ? "35px" : addStage !== 0 ? "35px" : "55px",
      position: "absolute",
      borderRadius: 0,
      height: 140,
      zIndex: 1000,
    },
  });

  const textareaStyle = useSpring({
    padding: addStage === 1 ? "10px 20px" : "0px 20px",
    outline:
      addStage === 1
        ? !valueError
          ? "1px solid var(--Gc-2)"
          : "1px solid var(--Ac-3)"
        : "1px solid var(--Ec-4)",
    background:
      addStage === 1
        ? "linear-gradient(165deg, var(--Ac-4) -20%, var(--Ec-1) 120%)"
        : "none",
    position: "absolute",
    top: addStage > 1 ? 13 : 20,
    left: addStage > 1 ? 90 : 190,
  });

  const ConfirmStyle = useSpring({
    left: whichType ? "0%" : "43%",
    width: whichType ? "40%" : "57%",
    marginLeft: whichType ? 2 : -2,
  });

  const ConfirmStyleDay = useSpring({
    x: whichType ? 0 : 3,
  });
  const ConfirmStyleMonth = useSpring({
    x: whichType ? -4 : 0,
  });

  let fornatDefualtValue = new Intl.NumberFormat().format(defaultValue);

  fornatDefualtValue =
    Number(fornatDefualtValue[0]) !== 0 ? `$${fornatDefualtValue}` : "";
  const [modifyValue, setmodifyValue] = useState(false);
  useEffect(() => {
    if (!modifyValue && value.length > 0) {
      setmodifyValue(true);
    }
  }, [modifyValue, value.length]);

  const AnountStyle = useSpring({
    color: valueError ? "var(--Bc-1)" : "var(--Gc-1)",
    fontSize: `0.7rem`,
    // left: addStage > 1 ? 20 : 25,
    position: "absolute",
    top: addStage > 1 ? 30 : 35,
    left: addStage === 1 ? 85 : 40,
  });
  const AnountBorderStyle = useSpring({
    height: "auto",
  });

  const previousValue = useRef(value.length);

  const Imidiate = useRef(false);

  const handleValueChange = useCallback(() => {
    if (value.length === 0 && previousValue.current === 2) {
      setAnimate1(true);
      Imidiate.current = true;
    } else if (value.length === 2 && previousValue.current === 0) {
      setAnimate1(false);
    }

    if (
      (value.length === 2 && previousValue.current === 0) ||
      (value.length === 5 && previousValue.current === 6)
    ) {
      setAnimate2(true);
      Imidiate.current = true;
    } else if (
      (value.length === 0 && previousValue.current === 2) ||
      (value.length === 6 && previousValue.current === 5)
    ) {
      setAnimate2(false);
    }
  }, [value.length]);

  useEffect(() => {
    if (
      !Imidiate.current &&
      (previousValue.current === 2 || previousValue.current === 0)
    ) {
      handleValueChange();
    }
    previousValue.current = value.length;
  }, [handleValueChange, value.length]);

  const fontSize = useMemo(() => {
    return value.length > 0 ? "0.9rem" : "1.1rem";
  }, [value.length]);

  const fontColor = useMemo(() => {
    return value.length > 0 ? "var(--Fc-2)" : "var(--Gc-2)";
  }, [value.length]);

  const handleOnRest = () => {
    Imidiate.current = false;
  };

  const springProps = (animate, Imidiate) => ({
    from: {
      opacity: animate ? 0 : 0.6,
      transform: animate ? "scale(1.5)" : "scale(1)",
      fontSize: fontSize,
    },
    to: {
      opacity: addStage > 1 ? 0 : !animate ? 0 : 0.6,
      transform: !animate ? "scale(1.5)" : "scale(1)",
      fontSize: fontSize,
    },
    config: { duration: 500 },
    onRest: animate && Imidiate ? handleOnRest : undefined,
  });
  const [Animate1, setAnimate1] = useState(true);
  const [Animate2, setAnimate2] = useState(false);
  const style1 = useSpring(springProps(Animate1, Imidiate.current));
  const style2 = useSpring(springProps(Animate2, Imidiate.current));

  const handleChange = (event) => {
    setValueError(true);
    const numericValue = event.target.value.replace(/[^0-9]/g, "");
    const formattedValue = new Intl.NumberFormat().format(numericValue);
    setValue(numericValue.length > 0 ? `$${formattedValue}` : "");
  };

  const labelPar = useSpring({
    position: "absolute",
    top: 5,
    left: 0,
    margin: 0,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    flexDirection: "column",
  });
  const labelDot = useSpring({
    position: "relative",
    fontSize: "1.5em",
    color: "var(--Bc-2)",
    margin: "5px 10px 0px 17px",
    lineHeight: `15px`,
    width: 2,
    height: addStage > 1 ? 2 : 7,
    borderRadius: 30,
    background: "var(--Bc-2)",
  });
  const label = useSpring({
    position: "relative",
    fontSize: addStage !== 1 ? "1rem" : "0.7rem",
    color: "var(--Bc-2)",
    // border: "1px solid var(--Bc-2)",
    borderRadius: "30px",
    width: addStage !== 1 ? 35 : 70,
    height: 35,
    display: "flex",
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    marginTop: addStage !== 1 ? 15 : 20,
    cursor: addStage !== 1 ? "pointer" : "auto",
  });

  const exampleStyle = useSpring({
    opacity: addStage === 1 ? 1 : 0,
    x: addStage === 1 ? 0 : -20,
    y: addStage === 1 ? 0 : -20,
    scale: addStage === 1 ? 1 : 0.95,
  });

  const [example, setExample] = useState(null);

  const expenseExample = [5, 15, 25, 40, 60, 80, 100, 150, 200, 300];
  const incomeExample = [
    200, 500, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000,
  ];
  const saveExample = [50, 100, 200, 300, 500, 700, 1000, 1500, 2000, 3000];

  const getRandomExamples = (array) => {
    const shuffled = array.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 5);
  };

  useEffect(() => {
    if (isAddClicked === "Income") {
      setExample(getRandomExamples(incomeExample));
    } else if (isAddClicked === "Expense") {
      setExample(getRandomExamples(expenseExample));
    } else {
      setExample(getRandomExamples(saveExample));
    }
  }, [isAddClicked]);

  const handleExample = (value) => () => {
    setValue(`$${value}`);
    setValueError(true);
  };

  return (
    <animated.li
      className="Add_Amount"
      style={{ ...AnountBorderStyle, ...fade }}
    >
      <animated.div style={labelPar}>
        <animated.h2 style={labelDot}></animated.h2>{" "}
        <animated.h2 style={label}>
          {addStage === 1 ? "Amount" : <MdModeEditOutline />}
        </animated.h2>
      </animated.div>
      <animated.label style={AnountStyle}>
        {addStage === 1 && `Insert`} Amount:
      </animated.label>
      <div className="Add_edit">
        <MdModeEditOutline /> Tap fot Edit
      </div>
      <animated.textarea
        type="text"
        defaultValue={fornatDefualtValue}
        maxLength="11"
        inputMode="numeric"
        placeholder="$1000"
        value={modifyValue ? value : fornatDefualtValue}
        onChange={handleChange}
        style={textareaStyle}
      />
      <AmountLogo
        Animate1={Animate1}
        Animate2={Animate2}
        style1={style1}
        style2={style2}
        fontColor={fontColor}
      />

      <animated.div
        className="AddTransactionFeed_Examples"
        style={exampleStyle}
      >
        <animated.p>
          <span>{isAddClicked}</span> <span>Shorcuts :</span>
        </animated.p>
        {example &&
          example.map((value, index) => (
            <ScalableElement key={index} as="h4" onClick={handleExample(value)}>
              ${value}
            </ScalableElement>
          ))}
      </animated.div>
    </animated.li>
  );
};

export default Amount;
