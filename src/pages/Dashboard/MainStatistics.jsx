import React, { useEffect, useMemo, useRef } from "react";
import { useSprings, animated, useSpring } from "@react-spring/web";
import BlurFade from "@/components/ui/blur-fade";

// Constants
const PERCENTAGE_FACTOR = 40;
const MIN_PERCENTAGE = 10;
const FALLBACK_COLOR = "var(--Ac-2)";

// Utility function to calculate percentage
const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const calculatePercentage = (value, max) =>
  max === 0 ? 0 : (toFiniteNumber(value) / max) * PERCENTAGE_FACTOR;

const formatBalance = (value) =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toFiniteNumber(value));

const hasMonthData = (month) =>
  Math.abs(toFiniteNumber(month?.income)) +
    Math.abs(toFiniteNumber(month?.Expense)) +
    Math.abs(toFiniteNumber(month?.saving)) >
  0;

const MainStatistics = ({
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
        maxIncome: Math.max(acc.maxIncome, Math.abs(toFiniteNumber(d.income))),
        maxNet: Math.max(acc.maxNet, Math.abs(toFiniteNumber(d.net))),
        maxSaving: Math.max(acc.maxSaving, Math.abs(toFiniteNumber(d.saving))),
        maxExpense: Math.max(acc.maxExpense, Math.abs(toFiniteNumber(d.Expense))),
      }),
      { maxIncome: 0, maxNet: 0, maxSaving: 0, maxExpense: 0 }
    );

    const maxOfAll = Math.max(
      allValues.maxIncome,
      allValues.maxNet,
      allValues.maxSaving,
      allValues.maxExpense
    );

    return { ...allValues, maxOfAll };
  }, [last6MonthsData]);

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
    if (!processedData.length) return;

    const selectedMonth = processedData[mainPageMonth];
    if (selectedMonth && hasMonthData(selectedMonth)) return;

    const nextAvailableMonth = processedData.findIndex(hasMonthData);
    if (nextAvailableMonth !== -1 && nextAvailableMonth !== mainPageMonth) {
      setMainPageMonth(nextAvailableMonth);
    }
  }, [mainPageMonth, processedData, setMainPageMonth]);

  /* useEffect moved down */

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
        savingHeight: `${Math.abs(d.savingPercentage)}%`,
        netBottom: d.netPercentage > 0 ? "calc(50% + 10px)" : "none",
        netTop: d.netPercentage < 0 ? "calc(50% + 10px)" : "none",
        netHeight:
          d.netPercentage > 0 ? `${d.netPercentage}%` : `${-d.netPercentage}%`,
        ExpenseHeight: `${d.ExpensePercentage === 0 ? MIN_PERCENTAGE : d.ExpensePercentage
          }%`,
        ExpenseBg: d.ExpensePercentage === 0 ? FALLBACK_COLOR : null,
        incomeHeight: `${d.incomePercentage === 0 ? MIN_PERCENTAGE : d.incomePercentage
          }%`,
        incomeBg: d.incomePercentage === 0 ? FALLBACK_COLOR : null,
        opacity: 1,
        filter: index === mainPageMonth ? "grayscale(0)" : "grayscale(0.4)",
      },
      delay: index * 50,
    }))
  );

  // Keep enough chart room on short phones without letting it crowd the
  // summary cards on taller screens.
  const heightFactor = Math.min(250, Math.max(170, height * 0.36));

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
          ? Math.abs(data.savingPercentage) * 0.9 < 10
            ? 10
            : Math.abs(data.savingPercentage) * 0.9
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

  const monthRefs = useRef([]);

  useEffect(() => {
    monthRefs.current[mainPageMonth]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [mainPageMonth]);

  return (
    <div
      style={{ height: `${heightFactor + 48}px` }}
      className="MainStatistics"
    >
      <BlurFade
        delay={0.3 + 0.05 * 5}
        style={{ height: `${heightFactor + 48}px` }}
        duration={0.3}
      >
        <div className="MainStatistics-Content">
          <h3>
            <span className="MoneyEntry_Dot" style={{ color: "var(--Bc-1)" }}>
              •
            </span>
            <span>Insight</span> Dashboard
          </h3>
          <p className="MainStatistics-Balance" aria-live="polite">
            Balance: {formatBalance(processedData[mainPageMonth]?.net)}
          </p>
          <div
            className="MainStatistics-Graph"
          >
            <div
              className="MainStatistics-dash"
              style={{ left: "20px", width: "calc(100% - 25px)" }}
            ></div>
            <animated.div style={valueSpringIn} className="MainStatistics-dash">
              <animated.h1 style={valueSpringInText}>
                + $
                {processedData[mainPageMonth]
                  ? Number(processedData[mainPageMonth].income.toFixed(0))
                  : 0}
              </animated.h1>
            </animated.div>

            <animated.div style={valueSpringSp} className="MainStatistics-dash">
              <animated.h1 style={valueSpringSpText}>
                - $
                {processedData[mainPageMonth]
                  ? Number(processedData[mainPageMonth].Expense.toFixed(0))
                  : 0}
              </animated.h1>
            </animated.div>

            {/* <div className="MainStatistics-guid">
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
                  className="MainStatistics-batch"
                  ref={(element) => {
                    monthRefs.current[index] = element;
                  }}
                  style={{
                    opacity: 1,
                    filter: style.filter,
                    cursor: hasMonthData(processedData[index]) ? "pointer" : "default",
                  }}
                  onClick={() => {
                    hasMonthData(processedData[index]) && setMainPageMonth(index);
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
      </BlurFade>
    </div>
  );
};

export default MainStatistics;
