import React, { useEffect, useMemo, useState } from "react";
import { useSprings, animated, useSpring } from "react-spring";
import { useDrag, useWheel } from "@use-gesture/react";
import BlurFade from "@/components/ui/blur-fade";

// Constants
const PERCENTAGE_FACTOR = 40;
const MIN_PERCENTAGE = 10;
const FALLBACK_COLOR = "var(--Ac-2)";

// Utility function to calculate percentage
const calculatePercentage = (value, max) => (max === 0 ? 0 : (value / max) * PERCENTAGE_FACTOR);

const MainStatistics = ({
  height,
  netAmounts,
  mainPageMonth,
  setMainPageMonth,
  verticalShift = 0, // Accept verticalShift prop
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

    return { ...allValues, maxOfAll, highestCategory };
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
        savingHeight: `${d.savingPercentage}%`,
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
        opacity: index + 1 === mainPageMonth ? 0.9 : 0.5,
        filter: index === mainPageMonth ? "grayscale(0)" : "grayscale(0.4)",
      },
      delay: index * 50,
    }))
  );

  const buttunsHeight =
    ((420 - 20) / 2 / 1.8) * Math.min(height / 675, 1) * 2 + 10;
  const baseHeightFactor = height - buttunsHeight - height / 3.7;

  // Use fixed height factor to prevent UI jitter on month change
  const heightFactor = baseHeightFactor;

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

  // Sync animation X position when mainPageMonth changes
  useEffect(() => {
    // 50 is the assumed width per item used in existing logic
    const targetX = -50 * mainPageMonth;
    api.start({ x: targetX });
    setCurrentX(targetX);
  }, [mainPageMonth, api]);

  /* Ref to measure container width for dynamic bounds */
  const containerRef = React.useRef(null);

  /* Ref to track continuous visual position independent of mainPageMonth state */
  const visualX = React.useRef(0);

  // Update visualX when mainPageMonth changes programmatically
  useEffect(() => {
    visualX.current = -50 * mainPageMonth;
  }, [mainPageMonth]);

  /* Bounds Calculation */
  /* Bounds Calculation: Strict Center-to-Center */
  const minX = -(processedData.length - 1) * 50;
  const maxX = 0;

  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

  const bindDrag = useDrag(({ down, movement: [mx, my], memo = visualX.current }) => {
    // Dynamic Bounds: Stop when Last Item matches Right Edge + Margin
    const containerWidth = containerRef.current ? containerRef.current.offsetWidth : 0;
    const contentWidth = processedData.length * 50;
    // Add 100px buffer to ensure last items are fully visible/not cut off
    const dynamicMinX = Math.min(0, containerWidth - contentWidth - 100);

    let newX = memo + mx;
    newX = clamp(newX, dynamicMinX, maxX);

    api.start({ x: newX });

    if (!down) visualX.current = newX;

    return memo;
  }, {
    filterTaps: true,
    axis: 'x'
  });

  /* bindWheel: Map Vertical/Horizontal Scroll to Visual Pan. Does NOT change Month state. */
  const bindWheel = useWheel(({ active, movement: [mx, my], memo = 0 }) => {
    // Map Vertical (my = Scroll Down/Up) or Horizontal (mx) to Pan
    // Scroll Down (Positive my) -> Pan Left (Negative X in standard scroll)
    // But natural feel: Scroll Down -> Move View Right (Show next)

    // Let's use simple addition first.
    // If vertical is dominant, use it. Else use horizontal.
    const isVertical = Math.abs(my) > Math.abs(mx);
    const delta = isVertical ? my : mx;

    // Scale delta for sensitivity?
    const panX = delta * 1.5;

    const initialX = -50 * mainPageMonth;
    api.start({ x: initialX - panX }); // Subtracting delta to match natural scrolling direction? or Adding?
    // Let's try subtracting. (Scroll Down -> Move content Up/Right?)
    // Actually, usually Scroll Down = mx < 0 (Next). So if my > 0, we want mx style < 0.
    // So if my > 0 (Scroll Down), we want X to decrease (Next).
    // So x: initialX - my.

    return memo;
  });

  /* bindWheelNew: Pan with Bounds, Reduced Sensitivity */
  const bindWheelNew = useWheel(({ active, delta: [dx, dy], memo = visualX.current }) => {
    // Determine delta based on dominant axis
    const isVertical = Math.abs(dy) > Math.abs(dx);
    let delta = isVertical ? dy : dx;

    // Sensitivity Reduction: 0.5 factor
    const scrollStep = delta * 0.5;

    let newX = visualX.current - scrollStep;
    newX = clamp(newX, minX, maxX);

    api.start({ x: newX });
    visualX.current = newX;

    return memo;
  }, {
    modal: false
  });

  /* bindWheelDynamic: Pan with Dynamic Bounds (Viewport Aware) */
  const bindWheelDynamic = useWheel(({ active, delta: [dx, dy], memo = visualX.current }) => {
    // Dynamic Bounds for Wheel: Stop when Last Item matches Right Edge + Margin
    const containerWidth = containerRef.current ? containerRef.current.offsetWidth : 0;
    const contentWidth = processedData.length * 50;
    // Add 100px buffer to ensure last items are fully visible/not cut off
    const dynamicMinX = Math.min(0, containerWidth - contentWidth - 100);

    // Determine delta based on dominant axis
    const isVertical = Math.abs(dy) > Math.abs(dx);
    let delta = isVertical ? dy : dx;

    // Sensitivity Reduction: 0.5 factor
    const scrollStep = delta * 0.5;

    let newX = visualX.current - scrollStep;
    newX = clamp(newX, dynamicMinX, maxX);

    api.start({ x: newX });
    visualX.current = newX;

    return memo;
  }, {
    modal: false
  });

  return (
    <div
      style={{ height: `${heightFactor + 60}px` }}
      className="MainStatistics"
      {...bindDrag()}
      {...bindWheelDynamic()}
    >
      <BlurFade
        delay={0.3 + 0.05 * 5}
        style={{ height: `${heightFactor + 60}px` }}
        duration={0.3}
      >
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", transform: `translateY(${verticalShift * 0.5}%)` }}>
          <h3>
            <span className="MoneyEntry_Dot" style={{ color: "var(--Bc-1)" }}>
              •
            </span>
            <span>Insight</span> Dashboard
          </h3>
          <div
            ref={containerRef}
            className="MainStatistics-Graph"
            style={{ marginTop: `${marginTop}px`, flex: 1 }}
          >
            <div
              className="MainStatistics-dash"
              style={{ marginLeft: "20px", width: "calc(100%)" }}
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
                $
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
                  style={{
                    opacity: x.to((x) => {
                      const threshold = 50 * (index + 1) - 30;
                      const distance = -x - threshold;

                      const hasData =
                        Math.round(processedData[index].income) +
                        Math.round(processedData[index].Expense) +
                        Math.round(processedData[index].saving) !==
                        0;

                      const minOpacity = 0.0;
                      // If empty, maxOpacity is low (0.2). If selected 0.8, else 0.4
                      const maxOpacity = hasData
                        ? index === mainPageMonth
                          ? 0.8
                          : 0.4
                        : 0.2;

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
                      Math.round(processedData[index].income) +
                        Math.round(processedData[index].Expense) +
                        Math.round(processedData[index].saving) !==
                        0
                        ? "pointer"
                        : "default",
                  }}
                  onClick={() => {
                    Math.round(processedData[index].income) +
                      Math.round(processedData[index].Expense) +
                      Math.round(processedData[index].saving) !==
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
      </BlurFade>
    </div>
  );
};

export default MainStatistics;
