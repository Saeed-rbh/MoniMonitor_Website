import React, { useEffect, useState } from "react";
import { useSpring, animated, config } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { RxCross2 } from "react-icons/rx";
import { ScalableElement } from "./tools";
const MoreOpen = ({
  isClicked,
  setIsClicked,
  feed,
  MoreOpenHeight,
  handleCloseAddTransaction,
  zIndex = 105,
  blur = null,
}) => {
  const [isAnimationEnds, setIsAnimationEnds] = useState(false);
  useEffect(() => {
    !!isClicked && setIsAnimationEnds(true);
  }, [isClicked]);

  const [Open_TransactionList, api] = useSpring(() => ({
    scale: 0.9,
    opacity: 0,
    height: "calc(0vh - 65px)",
    zIndex: zIndex,
    filter: "blur(0px)",
  }));

  useEffect(() => {
    if (blur !== null) {
      api.start({
        scale: 0.9,
        opacity: 0.5,
        filter: "blur(10px)",
      });
    } else {
      api.start({
        scale: 1,
        opacity: 1,
        filter: "blur(0px)",
      });
    }
  }, [blur, api]);

  const isOpenRef = React.useRef(isClicked);

  React.useEffect(() => {
    isOpenRef.current = isClicked;
  }, [isClicked]);

  const handleOnRest = () => {
    !isOpenRef.current && setIsAnimationEnds(false);
  };

  useEffect(() => {
    isAnimationEnds &&
      api.start({
        scale: !!isClicked ? 1 : 0.9,
        opacity: !isClicked ? 0 : 1,
        height: !!isClicked
          ? `calc(100vh - ${MoreOpenHeight}px)`
          : `calc(0vh - ${MoreOpenHeight}px)`,
        onRest: () => {
          handleOnRest();
        },
      });
  }, [isClicked, isAnimationEnds, api]);

  const bind = useDrag(
    ({
      movement: [, y],
      memo = false,
      last,
      velocity,
      event,
      initial: [, initialY],
    }) => {
      const clientY = event.touches ? event.touches[0].clientY : event.clientY;
      if (!isClicked) return memo;
      if (clientY - y > 400 || y < 0) return memo;

      const newHeight = Math.max(y + MoreOpenHeight, MoreOpenHeight);
      const isQuickDragDown = velocity[1] > 0.01 && y > initialY;
      const isQuickDragUp = velocity[1] > 0.1 && y < initialY;

      if (y > 0) {
        if (last) {
          if (isQuickDragUp) {
            api.start({
              height: `calc(100vh - ${MoreOpenHeight}px)`,
              config: config.slow,
            });
          } else if (isQuickDragDown) {
            api.start({
              height: `calc(10vh  - ${MoreOpenHeight}px)`,
              config: config.slow,
            });
            setIsClicked(null);
          } else if (
            window.innerHeight - newHeight <
            window.innerHeight / 2.2
          ) {
            api.start({
              height: `calc(10vh  - ${MoreOpenHeight}px)`,
            });
            setIsClicked(null);
          } else {
            api.start({
              height: `calc(100vh - 100px)`,
            });
          }
        } else {
          api.start({
            height: `calc(100vh - ${newHeight}px)`,
          });
        }
      }
      return memo;
    }
  );

  const handleCloseClick = () => {
    setIsClicked(null);
    handleCloseAddTransaction && handleCloseAddTransaction();
  };

  return (
    <>
      {isAnimationEnds && (
        <animated.div
          className="MoreOpen_Main"
          style={Open_TransactionList}
          {...bind()}
        >
          <animated.div
            className="MoreOpen_Wall"
            style={{ background: "var(--Ec-2)" }}
          >
            <div
              className="MoreOpen_TopLine"
              style={{
                background: "var(--Ac-3)",
                height: "1px",
                marginTop: "30px",
                width: "75%",
                marginRight: "55px",
                opacity: "0.5",
              }}
            ></div>
            <ScalableElement
              as="div"
              className="MoreOpen_Close"
              onClick={handleCloseClick}
            >
              <RxCross2 />
            </ScalableElement>
            {feed()}
          </animated.div>
        </animated.div>
      )}
    </>
  );
};

export default MoreOpen;
