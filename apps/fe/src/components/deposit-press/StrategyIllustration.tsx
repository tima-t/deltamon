"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, usePageInView, useReducedMotion } from "motion/react";
import { DepositStrategyBranch } from "@/components/DepositStrategyBranch";
import styles from "./concepts.module.css";

/** The lab's actual artwork, shown as an explanation separate from the receipt. */
export default function StrategyIllustration({
  confirmed,
  paused,
  reducedMotion,
  autoPlayKey,
  onStrategyEnd,
}: {
  confirmed: boolean;
  paused: boolean;
  reducedMotion: boolean;
  autoPlayKey?: string;
  onStrategyEnd?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const inView = useInView(host, { amount: 0.15 });
  const pageVisible = usePageInView();
  const prefersReducedMotion = useReducedMotion();
  const reduced = reducedMotion || Boolean(prefersReducedMotion);
  const [width, setWidth] = useState(440);
  const [playing, setPlaying] = useState(false);
  const [replay, setReplay] = useState(0);
  const played = useRef<string | undefined>(undefined);
  const playKey = autoPlayKey ?? (confirmed ? "preview" : undefined);
  const running = !paused && !reduced && inView && pageVisible;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playKey) played.current = undefined;
    if ((playing && reduced) || (playKey && played.current !== playKey && (running || reduced))) {
      const frame = requestAnimationFrame(() => {
        played.current = playKey;
        if (reduced) onStrategyEnd?.();
        setPlaying(!reduced);
        if (!reduced) setReplay((value) => value + 1);
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [playKey, playing, reduced, running, onStrategyEnd]);

  return (
    <div
      className={styles.strategy}
      ref={host}
      data-motion={running ? "running" : "paused"}
      data-reduced-motion={reduced}
      data-playing={playing}
    >
      <div className={styles.vaultOrigin}>
        <span>◈</span> MONAD VAULT <small>STRATEGY EXPLANATION</small>
      </div>
      <svg
        className={styles.strategyConnector}
        viewBox={`0 0 ${width} 32`}
        aria-hidden="true"
        key={`connector-${replay}`}
      >
        <path d={`M${width / 2} 0 V32`} />
        <path className={styles.strategyCarrier} d={`M${width / 2} 0 V32`} pathLength="1" />
      </svg>
      <DepositStrategyBranch
        mapWidth={width}
        motionEnabled={!paused && !reduced}
        replay={replay}
        playing={playing}
        automatic={Boolean(playKey)}
        onReplay={() => {
          setPlaying(true);
          setReplay((value) => value + 1);
        }}
        onReplayEnd={() => {
          setPlaying(false);
          onStrategyEnd?.();
        }}
      />
      <p className={styles.strategyBoundary}>
        The share receipt does not confirm either position. This animation illustrates what the
        vault does separately.
      </p>
    </div>
  );
}
