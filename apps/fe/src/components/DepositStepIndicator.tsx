"use client";

import { motion, useReducedMotion } from "motion/react";

export type DepositStep = "connect" | "source" | "amount" | "review" | "track";

export function DepositStepIndicator({
  current,
  includeSource = false,
}: {
  current: DepositStep;
  includeSource?: boolean;
}) {
  const reduced = useReducedMotion();
  const steps: { id: DepositStep; label: string }[] = [
    { id: "connect", label: "Access" },
    ...(includeSource ? [{ id: "source" as const, label: "Source" }] : []),
    { id: "amount", label: "Amount" },
    { id: "review", label: "Review" },
    { id: "track", label: "Track" },
  ];
  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === current),
  );

  return (
    <nav className="deposit-step-nav" aria-label="Deposit progress">
      <motion.span
        className="deposit-step-underline"
        aria-hidden="true"
        style={{ width: `${100 / steps.length}%` }}
        initial={false}
        animate={{ x: `${activeIndex * 100}%` }}
        transition={{ type: "spring", duration: reduced ? 0 : 0.42, bounce: 0 }}
      />
      <ol className="deposit-step-list">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="deposit-step-item"
            data-state={index < activeIndex ? "past" : index === activeIndex ? "current" : "future"}
            aria-current={index === activeIndex ? "step" : undefined}
          >
            <span className="deposit-step-number">
              {index < activeIndex ? "✓" : `0${index + 1}`}
            </span>
            <span className="deposit-step-label">{step.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
