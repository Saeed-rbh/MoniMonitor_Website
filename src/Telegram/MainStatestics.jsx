import React, { useEffect, useMemo, useState } from "react";
import { useSprings, animated, useSpring } from "react-spring";
import { useDrag } from "@use-gesture/react";

// Constants
const PERCENTAGE_FACTOR = 40;
const MIN_PERCENTAGE = 10;
const FALLBACK_COLOR = "var(--Ac-2)";

// Utility function to calculate percentage
const calculatePercentage = (value, max) => (value / max) * PERCENTAGE_FACTOR;

const MainStatestics = ({
  height,
  netAmounts,
  mainPageMonth,
  setMainPageMonth,
}) => {
  const netSeries = useMemo(
    () => Object.entries(netAmounts).reverse(),
    [netAmounts]
  );

  const last6MonthsData = useMemo(
    () => netSeries.map(([Date, value]) => value),
    [netSeries]
  );

  const MonthsData = useMemo(
    () => netSeries.map(([Date, value]) => Date.split("-")[0]),
    [netSeries]
  );

  const maxValues = useMemo(() => {
    const allValues = last6MonthsData.reduce(
      (acc, d) => ({
        maxIncome: Math.max(acc.maxIncome, d.income),
        maxNet: Math.max(acc.maxNet, d.net),
        maxSaving: Math.max(acc.maxSaving, d.saving),
        maxExpense: Math.max(acc.maxExpense, d.Expense),
      }),
      { maxIncome: 0, maxNet: 0, maxSaving: 0, maxExpense: 0 }
    );

    const maxOfAll = Math.max(
      allValues.maxIncome,
      allValues.maxNet,
      allValues.maxSaving,
      allValues.maxExpense
    );

    let highestCategory = "";
    if (maxOfAll === allValues.maxIncome) highestCategory = "Income";
    else if (maxOfAll === allValues.maxNet) highestCategory = "Net";
    else if (maxOfAll === allValues.maxSaving) highestCategory = "Saving";
    else if (maxOfAll === allValues.maxExpense) highestCategory = "Expense";

    return { maxOfAll, highestCategory };
  }, [last6MonthsData]);

  const marginTop = maxValues.highestCategory === "Expense" ? 20 : 30;

  const processedData = useMemo(
    () =>
      last6MonthsData.map((d, index) => ({
        ...d,
        incomePercentage: calculatePercentage(d.income, maxValues.maxOfAll),
        netPercentage: calculatePercentage(d.net, maxValues.maxOfAll),
        savingPercentage: calculatePercentage(d.saving, maxValues.maxOfAll),
        ExpensePercentage: calculatePercentage(d.Expense, maxValues.maxOfAll),
        year: MonthsData[index],
      })),
    [last6MonthsData, maxValues.maxOfAll, MonthsData]
  );

  useEffect(() => {
    processedData.length > 0 &&
      processedData[mainPageMonth].income +
        processedData[mainPageMonth].Expense +
        processedData[mainPageMonth].saving ===
        0 &&
      setMainPageMonth(mainPageMonth + 1);
  }, [processedData]);

  const springs = useSprings(
    processedData.length,
    processedData.map((d, index) => ({
      from: {
        savingHeight: "0%",
        netHeight: "0%",
        ExpenseHeight: "0%",
        incomeHeight: "0%",
      },
      to: {
        savingDesplay: d.savingPercentage === 0 ? "none" : "flex",
        netDesplay: d.netPercentage === 0 ? "none" : "flex",
        savingHeight: `${d.savingPercentage}%`,
        netBottom: d.netPercentage > 0 ? "calc(50% + 10px)" : "none",
        netTop: d.netPercentage < 0 ? "calc(50% + 10px)" : "none",
        netHeight:
          d.netPercentage > 0 ? `${d.netPercentage}%` : `${-d.netPercentage}%`,
        ExpenseHeight: `${
          d.ExpensePercentage === 0 ? MIN_PERCENTAGE : d.ExpensePercentage
        }%`,
        ExpenseBg: d.ExpensePercentage === 0 ? FALLBACK_COLOR : null,
        incomeHeight: `${
          d.incomePercentage === 0 ? MIN_PERCENTAGE : d.incomePercentage
        }%`,
        incomeBg: d.incomePercentage === 0 ? FALLBACK_COLOR : null,
        opacity: index + 1 === mainPageMonth ? 0.9 : 0.5,
        filter: index === mainPageMonth ? "grayscale(0)" : "grayscale(0.4)",
      },
      delay: index * 50,
    }))
  );

  const buttunsHeight =
    ((390 - 20) / 2 / 1.6) * Math.min(height / 675, 1) * 2 + 10;
  const heightFactor = height - buttunsHeight - height / 3.7;

  const valueSpringIn = useSpring({
    position: "absolute",
    y: Math.min(
      0,
      processedData[mainPageMonth] &&
        -1 *
          heightFactor *
          0.01 *
          processedData[mainPageMonth].incomePercentage -
          25,
      processedData[mainPageMonth] &&
        -1 *
          heightFactor *
          0.01 *
          processedData[mainPageMonth].savingPercentage -
          25
    ),
  });

  const valueSpringInText = useSpring({
    marginBottom:
      Math.min(
        0,
        processedData[mainPageMonth] &&
          -1 *
            heightFactor *
            0.01 *
            processedData[mainPageMonth].incomePercentage -
            25,
        processedData[mainPageMonth] &&
          -1 *
            heightFactor *
            0.01 *
            processedData[mainPageMonth].savingPercentage -
            25
      ) < -60
        ? 0
        : 40,
  });

  const valueSpringSp = useSpring({
    position: "absolute",
    y: processedData[mainPageMonth]
      ? heightFactor *
          0.01 *
          1.1 *
          processedData[mainPageMonth].ExpensePercentage +
        15
      : 0,
  });
  const valueSpringSpText = useSpring({
    marginTop:
      processedData[mainPageMonth] &&
      heightFactor *
        0.01 *
        1.1 *
        processedData[mainPageMonth].ExpensePercentage +
        15 >
        50
        ? -25
        : 15,
  });

  const data = processedData[mainPageMonth];
  const springGuid = useSprings(
    4,
    [
      {
        width: data
          ? data.incomePercentage * 0.9 < 10
            ? 10
            : data.incomePercentage * 0.9
          : 10,
        background: "var(--Fc-1)",
        outline: "3px solid var(--Fc-3)",
      },
      {
        width: data
          ? data.netPercentage * 0.9 < 10
            ? 10
            : data.netPercentage * 0.9
          : 10,
        background: "var(--Bc-1)",
        outline: "3px solid var(--Bc-3)",
      },
      {
        width: data
          ? data.savingPercentage * 0.9 < 10
            ? 10
            : data.savingPercentage * 0.9
          : 10,
        background: "var(--Ac-1)",
        outline: "3px solid var(--Ac-3)",
      },
      {
        width: data
          ? data.ExpensePercentage * 0.9 < 10
            ? 10
            : data.ExpensePercentage * 0.9
          : 10,
        background: "var(--Gc-1)",
        outline: "3px solid var(--Gc-3)",
      },
    ].map((item) => ({
      width: item.width,
      background: item.background,
      outline: item.outline,
    }))
  );

  const [{ x }, api] = useSpring(() => ({ x: 0 }));
  const [currentX, setCurrentX] = useState(0);

  const bind = useDrag(({ down, movement: [mx], cancel, memo = false }) => {
    springs.length < 5 && cancel();
    const newX = currentX + mx;
    if (newX > 0) return setCurrentX(0) && setMainPageMonth(1);
    if (-1 * newX > 31.5 * springs.length)
      return setCurrentX(-31.5 * springs.length);

    if (!down) {
      setCurrentX(newX);
    }
    api.start({ x: down ? newX : newX });
  });

  return (
    <div
      style={{ height: `${heightFactor + 60}px` }}
      className="MainStatestics"
      {...bind()}
    >
      <h3>
        <span className="MoneyEntry_Dot" style={{ color: "var(--Bc-1)" }}>
          •
        </span>
        <span>Insight</span> Dashboard
      </h3>
      {/* <ScalableElement as="div" className="MainStatestics-arrowN">
        <animated.div
          style={{ opacity: 0.4 }}
          className="CirleColor"
        ></animated.div>
        <MdKeyboardArrowRight />
      </ScalableElement>
      <ScalableElement as="div" className="MainStatestics-arrowL">
        <animated.div
          style={{ opacity: 0.4 }}
          className="CirleColor"
        ></animated.div>
        <MdKeyboardArrowLeft />
      </ScalableElement> */}
      {/* <ScalableElement as="div" className="MainStatestics-arrowC">
        {" "}
        <animated.div
          style={{ opacity: 0.4 }}
          className="CirleColor"
        ></animated.div>
        Current Month
      </ScalableElement> */}

      <div
        className="MainStatestics-Graph"
        style={{ marginTop: `${marginTop}px` }}
      >
        <div
          className="MainStatestics-dash"
          style={{ marginLeft: "20px", width: "calc(100%)" }}
        ></div>
        <animated.div style={valueSpringIn} className="MainStatestics-dash">
          <animated.h1 style={valueSpringInText}>
            + $
            {processedData[mainPageMonth]
              ? Number(processedData[mainPageMonth].income.toFixed(0))
              : 0}
          </animated.h1>
        </animated.div>

        <animated.div style={valueSpringSp} className="MainStatestics-dash">
          <animated.h1 style={valueSpringSpText}>
            - $
            {processedData[mainPageMonth]
              ? Number(processedData[mainPageMonth].Expense.toFixed(0))
              : 0}
            $
          </animated.h1>
        </animated.div>

        {/* <div className="MainStatestics-guid">
          <p>
            Income
            <animated.span
              style={{
                width: springGuid[0].width,
                background: springGuid[0].background,
                outline: springGuid[0].outline,
              }}
            ></animated.span>
          </p>
          <p>
            Balance
            <animated.span
              style={{
                width: springGuid[1].width,
                background: springGuid[1].background,
                outline: springGuid[1].outline,
              }}
            ></animated.span>
          </p>
          <p>
            Saving
            <animated.span
              style={{
                width: springGuid[2].width,
                background: springGuid[2].background,
                outline: springGuid[2].outline,
              }}
            ></animated.span>
          </p>
          <p>
            Expense
            <animated.span
              style={{
                width: springGuid[3].width,
                background: springGuid[3].background,
                outline: springGuid[3].outline,
              }}
            ></animated.span>
          </p>
        </div> */}

        <animated.ul>
          {springs.map((style, index) => (
            <animated.div
              key={index}
              className="MainStatestics-batch"
              style={{
                opacity: x.to((x) => {
                  const threshold = 50 * (index + 1) - 30;
                  const distance = -x - threshold;

                  const minOpacity = 0.0;
                  const maxOpacity = index === mainPageMonth ? 0.8 : 0.4;
                  const fadeDistance = 5;

                  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
                  const transition = sigmoid(distance / fadeDistance);

                  const opacity =
                    maxOpacity * (1 - transition) + minOpacity * transition;
                  return opacity;
                }),
                filter: style.filter,
                transform: x.to((x) => `translate3d(${x}px,0,0)`),
                cursor:
                  processedData[index].income +
                    processedData[index].Expense +
                    processedData[index].saving !==
                  0
                    ? "pointer"
                    : "default",
              }}
              onClick={() => {
                processedData[index].income +
                  processedData[index].Expense +
                  processedData[index].saving !==
                  0 && setMainPageMonth(index);
              }}
            >
              <li></li>
              <animated.li
                style={{
                  height: style.savingHeight,
                  display: style.savingDesplay,
                }}
              ></animated.li>
              <animated.li
                style={{
                  height: style.netHeight,
                  display: style.netDesplay,
                  bottom: style.netBottom,
                  top: style.netTop,
                }}
              ></animated.li>
              <animated.li
                style={{
                  height: style.ExpenseHeight,
                  background: style.ExpenseBg,
                }}
              ></animated.li>
              <animated.li
                style={{
                  height: style.incomeHeight,
                  background: style.incomeBg,
                }}
              ></animated.li>
              <li>
                {processedData[index].month}{" "}
                <span>{processedData[index].year}</span>
              </li>
            </animated.div>
          ))}
        </animated.ul>
      </div>
    </div>
  );
};

export default MainStatestics;
