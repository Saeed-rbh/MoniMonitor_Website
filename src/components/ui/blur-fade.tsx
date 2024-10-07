// "use client";

// import { useRef, CSSProperties } from "react";
// import {
//   AnimatePresence,
//   motion,
//   useInView,
//   UseInViewOptions,
//   Variants,
// } from "framer-motion";

// type MarginType = UseInViewOptions["margin"];

// interface BlurFadeProps {
//   children: React.ReactNode;
//   className?: string;
//   style?: CSSProperties;  // Add a style prop to accept inline styles
//   variant?: {
//     hidden: { y: number };
//     visible: { y: number };
//   };
//   duration?: number;
//   delay?: number;
//   yOffset?: number;
//   inView?: boolean;
//   inViewMargin?: MarginType;
//   blur?: string;
// }

// export default function BlurFade({
//   children,
//   className,
//   style,
//   variant,
//   duration = 0.3,
//   delay = 200,
//   yOffset = 10,
//   inView = false,
//   inViewMargin = "-50px",
//   blur = "6px",
// }: BlurFadeProps) {
//   const ref = useRef(null);
//   const inViewResult = useInView(ref, { once: true, margin: inViewMargin });
//   const isInView = !inView || inViewResult;
//   const defaultVariants: Variants = {
//     hidden: { y: yOffset, opacity: 0, filter: `blur(${blur})`, width: "100%" },
//     visible: { y: 0, opacity: 1, filter: `blur(0px)`, width: "100%" },
//   };
//   const combinedVariants = variant || defaultVariants;
  
//   return (
//     <AnimatePresence>
//       <motion.div
//         ref={ref}
//         initial="hidden"
//         animate={isInView ? "visible" : "hidden"}
//         exit="hidden"
//         variants={combinedVariants}
//         transition={{
//           delay: 0.04 + delay,
//           duration,
//           ease: "easeOut",
//         }}
//         className={className}
//         style={style}  // Apply the inline style prop
//       >
//         {children}
//       </motion.div>
//     </AnimatePresence>
//   );
// }

"use client";

import { useRef, CSSProperties } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  UseInViewOptions,
  Variants,
} from "framer-motion";

type MarginType = UseInViewOptions["margin"];

interface BlurFadeProps {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;  // Add a style prop to accept inline styles
  variant?: {
    hidden: { y: number };
    visible: { y: number };
  };
  duration?: number;
  delay?: number;
  yOffset?: number;
  inView?: boolean;
  inViewMargin?: MarginType;
  blur?: string;
}

export default function BlurFade({
  children,
  className,
  style,
  variant,
  duration = 0.3,
  delay = 200,
  yOffset = 10,
  inView = false,
  inViewMargin = "-50px",
  blur = "6px",
}: BlurFadeProps) {
  const ref = useRef(null);
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin });
  const isInView = !inView || inViewResult;
  const defaultVariants: Variants = {
    hidden: { y: yOffset, opacity: 0, filter: `blur(${blur})`, width: "100%" },
    visible: { y: 2, opacity: 1, filter: `blur(0px)`, width: "100%" },  // Set y to 2
  };
  const combinedVariants = variant || defaultVariants;

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        exit="hidden"
        variants={combinedVariants}
        transition={{
          delay: 0.04 + delay,
          type: "spring", // Use spring for a soft bounce effect
          stiffness: 40,  // Lower stiffness for softer bounce
          damping: 5,     // Reduce damping for more pronounced bounce
          mass: 0.5,      // Add mass to slow down the bounce
          duration,
        }}
        className={className}
        style={style}  // Apply the inline style prop
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
