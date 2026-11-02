import React, { useLayoutEffect, useState } from "react";
import { motion, useDragControls } from "framer-motion";
import { RxCross2 } from "react-icons/rx";
import { ScalableElement } from "../../utils/tools";
import { useNavigate } from "react-router-dom";
import "./MoreOpen.css";

const MoreOpen = ({
  isClicked,
  setIsClicked,
  feed,
  fillAvailable = false,
  handleCloseAddTransaction,
  zIndex = 105,
  toRedirect,
}) => {
  const redirect = useNavigate();
  const controls = useDragControls();
  const [headerBottom, setHeaderBottom] = useState(0);

  useLayoutEffect(() => {
    const header = document.querySelector(".MoneyMonitor_header");
    const updateBoundary = () => {
      setHeaderBottom(Math.max(0, header?.getBoundingClientRect().bottom ?? 0));
    };
    updateBoundary();
    const observer = new ResizeObserver(updateBoundary);
    if (header) observer.observe(header);
    window.addEventListener("resize", updateBoundary);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBoundary);
    };
  }, [isClicked]);

  const handleClose = () => {
    setIsClicked(null);
    if (handleCloseAddTransaction) handleCloseAddTransaction();
  };

  const handleAnimationComplete = (definition) => {
    if (definition === "hidden" && toRedirect) {
      redirect(toRedirect);
    }
  };

  const variants = {
    hidden: {
      y: "100%",
      transition: {
        type: "tween",
        ease: "easeInOut",
        duration: 0.3
      }
    },
    visible: {
      y: 0,
      transition: {
        type: "tween",
        ease: "easeInOut",
        duration: 0.5
      }
    }
  };

  return (
    <motion.div
      className={`MoreOpen_Main${fillAvailable ? " MoreOpen_Main--fill" : ""}`}
      initial="hidden"
      animate={!!isClicked ? "visible" : "hidden"}
      variants={variants}
      onAnimationComplete={handleAnimationComplete}
      style={{
        zIndex: zIndex,
        "--popup-max-height": `calc(100dvh - ${headerBottom}px)`,
        bottom: 0,
        position: "fixed",
        left: 0,
        right: 0,
        margin: "0 auto",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        pointerEvents: !!isClicked ? "auto" : "none", // Disable interaction when hidden
      }}
      drag="y"
      dragControls={controls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.2 }}
      onDragEnd={(event, info) => {
        if (info.offset.y > 100 || info.velocity.y > 200) {
          handleClose();
        }
      }}
    >
      <div
        className="MoreOpen_Wall"
        style={{
          background: "var(--Ec-2)",
          width: "100%",
          maxWidth: "var(--app-max-width)",
          boxSizing: "border-box",
        }}
      >
        <ScalableElement
          as="div"
          className="MoreOpen_Close"
          onClick={handleClose}
        >
          <RxCross2 />
        </ScalableElement>
        {feed()}
      </div>
    </motion.div>
  );
};

export default MoreOpen;
