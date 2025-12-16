import { useCallback, useRef } from "react";
import { useLongPress } from "use-long-press";

const useLongPressHandler = ({ isLongPress, setIsLongPress, component }) => {
  const longPressTimeout = useRef(null);

  navigator.vibrate =
    navigator.vibrate ||
    navigator.webkitVibrate ||
    navigator.mozVibrate ||
    navigator.msVibrate;

  const startLongPress = useCallback((event) => {
    longPressTimeout.current = setTimeout(() => {
      if (navigator.vibrate) {
        navigator.vibrate(1000);
      }
      setIsLongPress([true, component]);
    }, 500);
  }, []);

  const handleMove = useCallback(
    (event) => {
      if (isLongPress[0]) {
      }
    },
    [isLongPress]
  );

  const longBind = useLongPress(true ? startLongPress : null, {
    onStart: (event) => {
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("touchmove", handleMove);
    },
  });

  return longBind;
};

export default useLongPressHandler;
