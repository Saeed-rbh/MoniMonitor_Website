import React, { useRef, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useDragControls, useReducedMotion } from "framer-motion";
import { RxCross2 } from "react-icons/rx";
import { useModalFocus } from "../../utils/modalFocus";
import { useNavigate } from "react-router-dom";
import "./MoreOpen.css";

const MoreOpen = ({
  isClicked,
  setIsClicked,
  feed,
  fillAvailable = false,
  sheetHeight = null,
  handleCloseAddTransaction,
  zIndex = 105,
  toRedirect,
  overflow,
  showBackdrop = true,
  dialogLabel = 'Details and actions',
}) => {
  const redirect = useNavigate();
  const controls = useDragControls();
  const dialogRef = useRef(null);
  const reducedMotion = useReducedMotion();
  const [headerBottom, setHeaderBottom] = useState(0);

  useLayoutEffect(() => {
    const header = document.querySelector(".MoneyMonitor_header");
    const monthSelector = header?.querySelector("[data-header-month-selector]");
    const updateBoundary = () => {
      // The absolutely positioned selector can extend below the header box.
      const bottom = Math.max(
        0,
        header?.getBoundingClientRect().bottom ?? 0,
        monthSelector?.getBoundingClientRect().bottom ?? 0,
      );
      setHeaderBottom(header ? Math.ceil(bottom) + 8 : 0);
    };
    updateBoundary();
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateBoundary) : null;
    if (header) observer?.observe(header);
    if (monthSelector) observer?.observe(monthSelector);
    window.addEventListener("resize", updateBoundary);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBoundary);
    };
  }, [isClicked]);

  const handleClose = () => {
    setIsClicked(null);
    if (handleCloseAddTransaction) handleCloseAddTransaction();
  };
  useModalFocus(Boolean(isClicked), dialogRef, handleClose);

  const handleExitComplete = () => {
    if (toRedirect) {
      redirect(toRedirect);
    }
  };

  const maxHeight = `calc(100dvh - ${headerBottom}px)`;
  const isAutoHeight = !fillAvailable && (!sheetHeight || sheetHeight === "auto" || sheetHeight === "fit-content");
  const calculatedHeight = isAutoHeight ? "auto" : maxHeight;

  const content = (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {!!isClicked && (
        <>
          {showBackdrop && (
            <motion.div
              key="more-open-backdrop"
              className="MoreOpen_Backdrop"
              style={{ zIndex: zIndex - 1, top: headerBottom }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.25 }}
              onClick={handleClose}
            />
          )}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={dialogLabel}
            tabIndex={-1}
            key="more-open-sheet"
            className="MoreOpen_Main"
            initial={{ y: reducedMotion ? 0 : "100%" }}
            animate={{ y: 0 }}
            exit={{ y: reducedMotion ? 0 : "100%" }}
            transition={{ type: "tween", ease: "easeInOut", duration: reducedMotion ? 0 : 0.32 }}
            style={{
              zIndex: zIndex,
              height: calculatedHeight,
              maxHeight,
              bottom: 0,
              position: "fixed",
              left: 0,
              right: 0,
              margin: "0 auto",
              width: "100%",
              maxWidth: "var(--dialog-max-width)",
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
                overflowY: isAutoHeight ? "auto" : overflow,
                width: "100%",
                maxWidth: "var(--dialog-max-width)",
                boxSizing: "border-box",
                height: isAutoHeight ? "auto" : "100%",
                maxHeight,
              }}
            >
              <div
                aria-hidden="true"
                className="MoreOpen_DragHandle"
                onPointerDown={(event) => controls.start(event)}
              />
              <button
                type="button"
                aria-label="Close dialog"
                className="MoreOpen_Close"
                onClick={handleClose}
              >
                <RxCross2 />
              </button>
              {feed()}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(<div data-modal-layer>{content}</div>, document.body) : content;
};

export default MoreOpen;
