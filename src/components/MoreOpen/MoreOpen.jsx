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
  MoreOpenHeight = 75,
  sheetHeight = null,
  handleCloseAddTransaction,
  zIndex = 105,
  toRedirect,
  overflow,
  showBackdrop = true,
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

  const isAutoHeight = sheetHeight === "auto" || sheetHeight === "fit-content";
  const calculatedHeight = isAutoHeight
    ? "auto"
    : (sheetHeight || `calc(100dvh - ${MoreOpenHeight}px)`);

  const content = (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {!!isClicked && (
        <>
          {showBackdrop && (
            <motion.div
              key="more-open-backdrop"
              className="MoreOpen_Backdrop"
              style={{ zIndex: zIndex - 1 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={handleClose}
            />
          )}
          <motion.div
            key="more-open-sheet"
            className="MoreOpen_Main"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", ease: "easeInOut", duration: 0.32 }}
            style={{
              zIndex: zIndex,
              height: calculatedHeight,
              maxHeight: "92dvh",
              bottom: 0,
              position: "fixed",
              left: 0,
              right: 0,
              margin: "0 auto",
              width: "100%",
              maxWidth: "var(--app-max-width)",
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
                overflow: overflow,
                width: "100%",
                maxWidth: "var(--app-max-width)",
                boxSizing: "border-box",
                height: isAutoHeight ? "auto" : "100%",
                maxHeight: "92dvh",
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
        </>
      )}
    </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
};

export default MoreOpen;
