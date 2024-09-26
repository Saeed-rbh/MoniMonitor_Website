import React, { useEffect, useState } from "react";
import { useSpring, animated, config } from "@react-spring/web";
import { useDrag } from "@use-gesture/react";
import { RxCross2 } from "react-icons/rx";
import { ScalableElement } from "./tools";
import { useNavigate } from "react-router-dom";

import "./MoreOpen.css";
const MoreOpen = ({
  isClicked,
  setIsClicked,
  feed,
  MoreOpenHeight,
  handleCloseAddTransaction,
  zIndex = 105,
  blur = false,
  toRedirect,
}) => {
  const redirect = useNavigate();

  const [isAnimationEnds, setIsAnimationEnds] = useState(false);
  useEffect(() => {
    -!!isClicked && setIsAnimationEnds(true);
  }, [isClicked]);

  const [Open_TransactionList, api] = useSpring(() => ({
    scale: 0.9,
    opacity: 0,
    height: "calc(0vh - 65px)",
    zIndex: zIndex,
    filter: "blur(0px)",
  }));

  useEffect(() => {
    if (blur) {
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
    if (isAnimationEnds) {
      api.start({
        scale: !!isClicked ? 1 : 0.9,
        opacity: !isClicked ? 0 : 1,
        height: !!isClicked
          ? `calc(100vh - ${MoreOpenHeight}px)`
          : `calc(0vh - ${MoreOpenHeight}px)`,
        onRest: () => {
          setTimeout(() => {
            handleOnRest();
          }, 0); // Delay the rest handler slightly
        },
      });
    }
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
    redirect(toRedirect);
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
            {/* <div
              className="MoreOpen_TopLine"
              style={{
                position: "absolute",
                background: "var(--Ac-3)",
                height: "1px",
                marginTop: "45px",
                width: "60%",
                left: "20px",
                opacity: "0.5",
              }}
            ></div> */}
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
