import React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
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

  const handleExitComplete = () => {
    if (toRedirect) {
      redirect(toRedirect);
    }
  };

  const content = (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {!!isClicked && (
        <motion.div
          key="more-open-sheet"
          className="MoreOpen_Main"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "tween", ease: "easeInOut", duration: 0.32 }}
          style={{
            zIndex: zIndex,
            height: `calc(100dvh - ${MoreOpenHeight}px)`,
            bottom: 0,
            position: "fixed",
            left: 0,
            right: 0,
            margin: "0 auto",
            width: "100%",
            maxWidth: "var(--app-max-width)",
            maxHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
          drag="y"
          dragControls={controls}
          dragListener={false}
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
              width: "100%",
              maxWidth: "var(--app-max-width)",
              boxSizing: "border-box",
              height: "100%",
            }}
          >
            <div
              aria-hidden="true"
              className="MoreOpen_DragHandle"
              onPointerDown={(event) => controls.start(event)}
            />
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
      )}
    </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
};

export default MoreOpen;
