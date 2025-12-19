import React, { useRef } from "react";
import { motion, useDragControls } from "framer-motion";
import { RxCross2 } from "react-icons/rx";
import { ScalableElement } from "../../utils/tools";
import { useNavigate } from "react-router-dom";
import "./MoreOpen.css";

const MoreOpen = ({
  isClicked,
  setIsClicked,
  feed,
  MoreOpenHeight,
  handleCloseAddTransaction,
  zIndex = 105,
  toRedirect,
  overflow,
}) => {
  const redirect = useNavigate();
  const controls = useDragControls();

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
      className="MoreOpen_Main"
      initial="hidden"
      animate={!!isClicked ? "visible" : "hidden"}
      variants={variants}
      onAnimationComplete={handleAnimationComplete}
      style={{
        zIndex: zIndex,
        height: `calc(100vh - ${MoreOpenHeight}px)`,
        bottom: 0,
        position: "fixed",
        width: "100%",
        maxHeight: "100vh",
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
          overflow: overflow,
          width: "380px",
          maxWidth: "100vw",
          height: "100%",
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
