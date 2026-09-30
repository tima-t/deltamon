"use client";

import { motion, useReducedMotion } from "motion/react";
import { getDepositStages, type DepositStageState } from "@/lib/crosschain/progress";

const segments = [
  "M60 96 C130 96 140 36 230 36",
  "M230 36 C315 36 325 96 410 96",
  "M410 96 C495 96 505 36 580 36",
];

const stations = [
  { x: 60, y: 96, label: "SOURCE" },
  { x: 230, y: 36, label: "MONAD" },
  { x: 410, y: 96, label: "VAULT" },
  { x: 580, y: 36, label: "SHARES" },
];

const stateLabel: Record<DepositStageState, string> = {
  complete: "CONFIRMED",
  active: "IN PROGRESS",
  waiting: "UP NEXT",
  failed: "NEEDS ATTENTION",
};

export function DepositJourney({
  status,
  sourceName,
  sourceTxSent,
  mintConfirmed,
  simulated = false,
}: {
  status?: string;
  sourceName: string;
  sourceTxSent: boolean;
  mintConfirmed: boolean;
  simulated?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const stages = getDepositStages(status, sourceName, sourceTxSent, mintConfirmed);
  const current = stages.findIndex((item) => item.state === "active" || item.state === "failed");
  const failed = stages.some((item) => item.state === "failed");
  const complete = stages.every((item) => item.state === "complete");

  return (
    <section
      aria-label={
        simulated ? "Simulated cross-chain deposit progress" : "Cross-chain deposit progress"
      }
      className="deposit-journey"
    >
      <div className="deposit-journey-topline">
        <span>DELTA / TRANSFER MAP 01</span>
        <span>{simulated ? "SIMULATED SIGNAL" : "AURORA + VAULT STATUS"}</span>
      </div>
      <div className="deposit-journey-body">
        <div className="deposit-journey-heading">
          <div>
            <p className="deposit-kicker">THE JOURNEY / {sourceName.toUpperCase()} → MONAD</p>
            <h3>
              {failed ? "A hold on the route." : complete ? "Shares arrived." : "Across the lines."}
            </h3>
          </div>
          <span className="deposit-journey-count" aria-live="polite">
            {complete
              ? "04 / 04 CONFIRMED"
              : `0${current + 1} / 04 ${failed ? "NEEDS ATTENTION" : "IN PROGRESS"}`}
          </span>
        </div>
        <div className="deposit-journey-map" aria-hidden="true">
          <span className="deposit-journey-map-label">ORIGIN / {sourceName.toUpperCase()}</span>
          <svg viewBox="0 0 640 132" preserveAspectRatio="xMidYMid meet">
            <path
              className="deposit-journey-map-guide"
              d="M60 96 C130 96 140 36 230 36 C315 36 325 96 410 96 C495 96 505 36 580 36"
            />
            {segments.map((path, index) => (
              <motion.path
                key={path}
                className="deposit-journey-map-done"
                d={path}
                initial={false}
                animate={{ pathLength: stages[index + 1]?.state === "complete" ? 1 : 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.65, ease: [0.2, 0, 0, 1] }}
              />
            ))}
            {current > 0 && !failed ? (
              <path className="deposit-journey-map-signal" d={segments[current - 1]} />
            ) : null}
            {stations.map((station, index) => (
              <g
                key={station.label}
                className={`deposit-journey-station deposit-journey-station-${stages[index]?.state}`}
              >
                {stages[index]?.state === "active" ? (
                  <circle
                    className="deposit-journey-station-orbit"
                    cx={station.x}
                    cy={station.y}
                    r="30"
                  />
                ) : null}
                <circle
                  className="deposit-journey-station-disc"
                  cx={station.x}
                  cy={station.y}
                  r="21"
                />
                <text x={station.x} y={station.y} dominantBaseline="central" textAnchor="middle">
                  {stages[index]?.state === "complete"
                    ? "✓"
                    : stages[index]?.state === "failed"
                      ? "!"
                      : `0${index + 1}`}
                </text>
              </g>
            ))}
          </svg>
          <span className="deposit-journey-map-label">DESTINATION / sdMON</span>
        </div>
        <ol className="deposit-journey-stages">
          {stages.map((item, index) => (
            <li
              key={item.title}
              data-state={item.state}
              aria-current={item.state === "active" ? "step" : undefined}
            >
              <div className="deposit-journey-stage-meta">
                <span>
                  0{index + 1} / {stations[index]?.label}
                </span>
                <span>{stateLabel[item.state]}</span>
              </div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
