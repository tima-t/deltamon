"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, usePageInView, useReducedMotion } from "motion/react";
import { getDepositStages, type DepositStageState } from "@/lib/crosschain/progress";
import { DepositStrategyBranch } from "./DepositStrategyBranch";

const stations = ["SOURCE", "MONAD", "VAULT", "SHARES"];
const stateLabel: Record<DepositStageState, string> = {
  complete: "CONFIRMED",
  active: "IN PROGRESS",
  waiting: "UP NEXT",
  failed: "NEEDS ATTENTION",
};
const drawEase = [0.22, 1, 0.36, 1] as const;

export function DepositJourney({
  status,
  sourceName,
  sourceTxSent,
  mintConfirmed,
  simulated = false,
  reducedMotion = false,
  strategyAutoPlayKey,
  onStrategyEnd,
}: {
  status?: string;
  sourceName: string;
  sourceTxSent: boolean;
  mintConfirmed: boolean;
  simulated?: boolean;
  reducedMotion?: boolean;
  /** Supplied only for a fresh, verified deposit; restored receipts omit it. */
  strategyAutoPlayKey?: string;
  onStrategyEnd?: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const reduceMotion = reducedMotion || prefersReducedMotion;
  const [paused, setPaused] = useState(false);
  const [strategyReplay, setStrategyReplay] = useState(0);
  const [strategyPlaying, setStrategyPlaying] = useState(false);
  const playedStrategyKey = useRef<string | undefined>(undefined);
  const [mapWidth, setMapWidth] = useState(560);
  const mapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(mapRef, { amount: 0.1 });
  const pageVisible = usePageInView();
  const motionEnabled = !reduceMotion && !paused;
  const motionRunning = motionEnabled && inView && pageVisible;
  const stages = getDepositStages(status, sourceName, sourceTxSent, mintConfirmed);
  const current = stages.findIndex((item) => item.state === "active" || item.state === "failed");
  const failed = stages.some((item) => item.state === "failed");
  const complete = stages.every((item) => item.state === "complete");
  const xs = stations.map((_, index) => 30 + ((mapWidth - 60) * index) / 3);
  const ys = [76, 36, 76, 36];
  const segments = xs.slice(0, -1).map((x, index) => {
    const next = xs[index + 1]!;
    const middle = (x + next) / 2;
    return `M${x} ${ys[index]} C${middle} ${ys[index]} ${middle} ${ys[index + 1]} ${next} ${ys[index + 1]}`;
  });
  const strategyBend = Math.min(14, (xs[2]! - mapWidth / 2) / 2);
  const strategyConnector = `M${xs[2]} 96 V${142 - strategyBend} Q${xs[2]} 142 ${xs[2]! - strategyBend} 142 H${mapWidth / 2 + strategyBend} Q${mapWidth / 2} 142 ${mapWidth / 2} ${142 + strategyBend} V156`;

  useEffect(() => {
    if (strategyPlaying && reduceMotion) {
      const frame = requestAnimationFrame(() => {
        setStrategyPlaying(false);
        onStrategyEnd?.();
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!strategyAutoPlayKey || playedStrategyKey.current === strategyAutoPlayKey) return;
    if (strategyPlaying || (!reduceMotion && !motionRunning)) return;
    const frame = requestAnimationFrame(() => {
      playedStrategyKey.current = strategyAutoPlayKey;
      if (reduceMotion) {
        onStrategyEnd?.();
      } else {
        setStrategyPlaying(true);
        setStrategyReplay((value) => value + 1);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [strategyAutoPlayKey, strategyPlaying, reduceMotion, motionRunning, onStrategyEnd]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMapWidth(Math.max(160, entry.contentRect.width));
    });
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      aria-label={
        simulated ? "Simulated cross-chain deposit progress" : "Cross-chain deposit progress"
      }
      className="deposit-journey"
      data-motion={motionRunning ? "running" : "paused"}
      data-reduced-motion={Boolean(reduceMotion)}
      data-strategy-playing={strategyPlaying}
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
          <span className="deposit-journey-count" role="status">
            {complete
              ? "04 / 04 CONFIRMED"
              : `0${current + 1} / 04 ${failed ? "NEEDS ATTENTION" : "IN PROGRESS"}`}
          </span>
        </div>
        <div className="deposit-journey-map" ref={mapRef}>
          <div className="deposit-journey-map-topline">
            <span className="deposit-journey-map-label">ORIGIN / {sourceName.toUpperCase()}</span>
            <button
              type="button"
              className="deposit-journey-motion-toggle"
              aria-pressed={paused}
              aria-label={paused ? "Resume diagram motion" : "Pause diagram motion"}
              disabled={Boolean(reduceMotion)}
              onClick={() => setPaused((value) => !value)}
            >
              {reduceMotion ? "REDUCED MOTION" : paused ? "RESUME MOTION" : "PAUSE MOTION"}
            </button>
          </div>
          <div className="deposit-journey-route" aria-hidden="true">
            <svg viewBox={`0 0 ${mapWidth} 158`}>
              <path
                className="deposit-journey-map-grid"
                d={`M0 36 H${mapWidth} M0 76 H${mapWidth}`}
              />
              {segments.map((path, index) => (
                <g key={index}>
                  <path className="deposit-journey-map-guide" d={path} />
                  <motion.path
                    className="deposit-journey-map-done"
                    d={path}
                    initial={false}
                    animate={{ pathLength: stages[index + 1]?.state === "complete" ? 1 : 0 }}
                    transition={{ duration: motionEnabled ? 0.65 : 0, ease: drawEase }}
                  />
                </g>
              ))}
              {current > 0 && !failed ? (
                <g key={current}>
                  <path
                    className="deposit-journey-map-signal-trail"
                    d={segments[current - 1]}
                    pathLength="1"
                  />
                  <path
                    className="deposit-journey-map-signal"
                    d={segments[current - 1]}
                    pathLength="1"
                  />
                </g>
              ) : null}
              <g key={`strategy-${strategyReplay}`}>
                <path className="deposit-journey-vault-branch" d={strategyConnector} />
                <path
                  className="deposit-journey-strategy-ink"
                  d={strategyConnector}
                  pathLength="1"
                />
                <path
                  className="deposit-journey-strategy-packet"
                  d={strategyConnector}
                  pathLength="1"
                />
              </g>
              {stations.map((label, index) => {
                const state = stages[index]!.state;
                const done = state === "complete";
                return (
                  <g
                    key={label}
                    transform={`translate(${xs[index]}, ${ys[index]})`}
                    className={`deposit-journey-station deposit-journey-station-${state}`}
                  >
                    <circle className="deposit-journey-station-register" r="27" />
                    {state === "active" ? (
                      <circle className="deposit-journey-station-orbit" r="27" />
                    ) : null}
                    <circle className="deposit-journey-station-disc" r="19" />
                    <motion.g
                      initial={false}
                      animate={{
                        opacity: done ? 0 : 1,
                        scale: done ? 0.25 : 1,
                        filter: done ? "blur(4px)" : "blur(0px)",
                      }}
                      transition={{ type: "spring", duration: motionEnabled ? 0.3 : 0, bounce: 0 }}
                    >
                      <text dominantBaseline="central" textAnchor="middle">
                        {state === "failed" ? "!" : `0${index + 1}`}
                      </text>
                    </motion.g>
                    <motion.path
                      className="deposit-journey-station-check"
                      d="M-7 0 L-2 5 L8 -6"
                      initial={false}
                      animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
                      transition={{ duration: motionEnabled ? 0.3 : 0, ease: drawEase }}
                    />
                    <text className="deposit-journey-station-label" y="43" textAnchor="middle">
                      {label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <DepositStrategyBranch
            mapWidth={mapWidth}
            motionEnabled={motionEnabled}
            replay={strategyReplay}
            playing={strategyPlaying}
            automatic={Boolean(strategyAutoPlayKey)}
            onReplay={() => {
              playedStrategyKey.current = strategyAutoPlayKey;
              setStrategyPlaying(true);
              setStrategyReplay((value) => value + 1);
            }}
            onReplayEnd={() => {
              setStrategyPlaying(false);
              onStrategyEnd?.();
            }}
          />
          <div className="deposit-journey-map-footer">
            <span>YOUR SHARE OF THE POOLED VAULT</span>
            <span>DESTINATION / sdMON</span>
          </div>
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
                  0{index + 1} / {stations[index]}
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
