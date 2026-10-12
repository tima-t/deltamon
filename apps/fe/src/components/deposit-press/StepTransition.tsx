"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import styles from "./concepts.module.css";

const StepPanel = forwardRef<
  HTMLDivElement,
  { children: ReactNode; direction: number; reduce: boolean; onSize: (height: number) => void }
>(function StepPanel({ children, direction, reduce, onSize }, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  useImperativeHandle(forwardedRef, () => ref.current!);
  useEffect(() => {
    const node = ref.current;
    if (!node || !present) return;
    const observer = new ResizeObserver(() => onSize(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [present, onSize]);
  return (
    <motion.div
      ref={ref}
      inert={!present}
      className={styles.stepPanel}
      custom={direction}
      variants={{
        enter: (d: number) => ({ opacity: reduce ? 1 : 0, x: reduce ? 0 : d * 22 }),
        center: { opacity: 1, x: 0 },
        exit: (d: number) => ({
          opacity: reduce ? 1 : 0,
          x: reduce ? 0 : -d * 12,
          transition: { duration: reduce ? 0 : 0.13 },
        }),
      }}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: reduce ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={() => {
        // A replaced action leaves focus on body; land on the new step, without scrolling.
        if (present && document.activeElement === document.body)
          ref.current
            ?.querySelector<HTMLElement>("[data-step-heading]")
            ?.focus({ preventScroll: true });
      }}
    >
      {children}
    </motion.div>
  );
});

export default function StepTransition({
  step,
  direction,
  reduce,
  children,
}: {
  step: number;
  direction: number;
  reduce: boolean;
  children: ReactNode;
}) {
  const [height, setHeight] = useState<number>();
  const onSize = useCallback((next: number) => setHeight(next), []);
  return (
    <motion.div
      className={styles.stepViewport}
      animate={{ height: height ?? "auto" }}
      transition={{ duration: reduce ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }}
    >
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <StepPanel key={step} direction={direction} reduce={reduce} onSize={onSize}>
          {children}
        </StepPanel>
      </AnimatePresence>
    </motion.div>
  );
}
