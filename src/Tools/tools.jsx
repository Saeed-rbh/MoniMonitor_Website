import { useEffect, useState, useCallback } from "react";
import { useSpring, animated } from "react-spring";
import { fetchTransactions } from "../Tools/transactionService";

export const formatNetTotal = (netTotal) => {
  const floatNetTotal = parseFloat(netTotal);
  if (floatNetTotal > 10000 || floatNetTotal < -10000) {
    return floatNetTotal.toFixed(0);
  } else if (floatNetTotal > 1000 || floatNetTotal < -1000) {
    return floatNetTotal.toFixed(1);
  } else {
    return floatNetTotal.toFixed(2);
  }
};

export const useWindowHeight = (initialOffset) => {
  const [height, setHeight] = useState(window.innerHeight - initialOffset);

  useEffect(() => {
    const handleResize = () => setHeight(window.innerHeight - initialOffset);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [initialOffset]);

  return height;
};

export const ScalableElement = ({
  as: Component = "h1",
  children,
  className,
  onClick,
  onMouseDown,
  key,
  style,
}) => {
  const [isScaled, setIsScaled] = useState(false);

  const handleMouseDown = useCallback(
    (e) => {
      setIsScaled(true);
      if (onMouseDown) onMouseDown();
    },
    [onMouseDown]
  );

  const handleMouseUp = useCallback(() => setIsScaled(false), []);

  const style_2 = useSpring({
    scale: isScaled ? 0.9 : 1,
  });

  const AnimatedComponent = animated(Component);

  return (
    <AnimatedComponent
      key={key}
      className={className}
      style={{ ...style, ...style_2 }}
      onClick={onClick}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
    >
      {children}
    </AnimatedComponent>
  );
};

export const useCustomSpring = (
  isMoreClicked,
  delay,
  isScrollingDown,
  scrollAble
) => {
  return useSpring({
    opacity: !!isMoreClicked ? (isScrollingDown && scrollAble ? 0 : 1) : 0,
    y: !!isMoreClicked ? (isScrollingDown && scrollAble ? -50 : 0) : 50,
    delay: !!isMoreClicked
      ? isScrollingDown !== null
        ? 0
        : 100 + 50 * delay
      : 0,
  });
};

export const Gradient = ({
  opacity = 0.4,
  blur = 10,
  background = "var(--Ac-3)",
  left = 20,
  top = 40,
}) => {
  return (
    <animated.div
      style={{
        opacity: opacity,
        filter: `blur(${blur}px)`,
        background: background,
        left: `-${left}%`,
        top: `-${top}%`,
      }}
      className="CirleColor"
    ></animated.div>
  );
};

export const useTransactionData = (whichMonth, userId) => {
  const [data, setData] = useState({
    selected: [],
    Availability: [],
    netAmounts: [],
  });

  useEffect(() => {
    const fetchData = async () => {
      const { selected, Availability, netAmounts, transactions } =
        await fetchTransactions({
          whichMonth,
          userId,
        });

      setData({
        selected: selected,
        Availability: Availability,
        transactions: transactions,
        netAmounts: netAmounts,
      });
    };
    fetchData();
  }, [whichMonth]);

  return data;
};
