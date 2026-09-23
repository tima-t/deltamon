"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { VaultStats } from "@deltamon/shared";
import { formatUsd, timeAgo } from "@/lib/format";

export function BalanceEngine({ stats }: { stats: VaultStats }) {
  const reduceMotion = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const { hedge } = stats;
  const illustrative = stats.source === "demo";
  const ageMs = hedge.reportAsOf ? now - new Date(hedge.reportAsOf).getTime() : Infinity;
  const freshNow = ageMs >= -30_000 && ageMs <= 300_000;
  const measured =
    !illustrative && hedge.dataStatus === "fresh" && hedge.netDeltaBps !== null && freshNow;
  const shownDelta = illustrative || measured ? hedge.netDeltaBps : null;
  const withinTarget = measured && Math.abs(hedge.netDeltaBps!) <= 200;
  const maxExposure = Math.max(hedge.longExposureUsd, hedge.shortExposureUsd ?? 0, 1);
  const longLength = hedge.longExposureUsd / maxExposure;
  const shortLength = hedge.shortExposureUsd === null ? 0 : hedge.shortExposureUsd / maxExposure;
  const needleAngle = measured ? Math.max(-35, Math.min(35, hedge.netDeltaBps! / 20)) : 0;
  const reportText = hedge.reportAsOf ? timeAgo(hedge.reportAsOf) : "No position report";
  const status = illustrative
    ? "Illustrative example"
    : hedge.dataStatus === "stale" || (hedge.dataStatus === "fresh" && !freshNow)
      ? "Manager report stale"
      : !measured
        ? "Hedge data unavailable"
        : withinTarget
          ? "Within ±2% target"
          : "Outside ±2% target";
  const tone = illustrative || !measured ? "muted" : withinTarget ? "good" : "warn";

  return (
    <figure
      className="instrument-card p-5 sm:p-7"
      aria-label="Balance Engine: MON held versus manager-reported MON short notional"
    >
      <div className="relative z-10 flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div>
          <p className="eyebrow">
            {illustrative ? "Illustrative instrument" : "Live instrument"} / 01
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
            The Balance Engine
          </h2>
        </div>
        <span className="status-pill shrink-0" data-tone={tone} role="status">
          {status}
        </span>
      </div>

      <div className="relative mx-auto mt-2 max-w-[480px]">
        <svg
          viewBox="0 0 400 400"
          className="w-full"
          role="img"
          aria-label={`${status}. Long ${formatUsd(hedge.longExposureUsd)}. Short ${hedge.shortExposureUsd === null ? "unavailable" : formatUsd(hedge.shortExposureUsd)}. Net exposure ${shownDelta === null ? "unavailable" : `${(shownDelta / 100).toFixed(2)} percent`}.`}
        >
          <circle cx="200" cy="200" r="177" fill="none" className="engine-rim" strokeWidth="1" />
          {Array.from({ length: 36 }, (_, index) => {
            const angle = (index * 10 * Math.PI) / 180;
            const inner = index % 3 === 0 ? 174 : 178;
            return (
              <line
                key={index}
                x1={200 + inner * Math.sin(angle)}
                y1={200 - inner * Math.cos(angle)}
                x2={200 + 184 * Math.sin(angle)}
                y2={200 - 184 * Math.cos(angle)}
                className="engine-tick"
                strokeWidth={index % 3 === 0 ? 1.3 : 0.7}
                opacity={index % 3 === 0 ? 0.8 : 0.4}
              />
            );
          })}
          <circle
            cx="200"
            cy="200"
            r="159"
            fill="none"
            className="engine-rim"
            strokeWidth="1"
            opacity=".7"
          />
          <path
            d="M 64 200 A 136 136 0 0 1 336 200"
            fill="none"
            className="engine-track"
            strokeWidth="20"
            strokeLinecap="round"
          />
          <path
            d="M 64 200 A 136 136 0 0 0 336 200"
            fill="none"
            className="engine-track"
            strokeWidth="20"
            strokeLinecap="round"
          />
          <motion.path
            d="M 64 200 A 136 136 0 0 1 336 200"
            fill="none"
            stroke="var(--exposure-long)"
            strokeWidth="20"
            strokeLinecap="round"
            initial={false}
            animate={{ pathLength: longLength }}
            transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          />
          <motion.path
            d="M 64 200 A 136 136 0 0 0 336 200"
            fill="none"
            stroke="var(--exposure-short)"
            strokeWidth="20"
            strokeLinecap="round"
            opacity={illustrative || measured ? 1 : 0.35}
            initial={false}
            animate={{ pathLength: shortLength }}
            transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          />
          <circle cx="200" cy="200" r="108" className="engine-body" strokeWidth="1.5" />
          <circle
            cx="200"
            cy="200"
            r="94"
            fill="none"
            className="engine-rim"
            strokeWidth="1"
            opacity=".45"
          />
          <path
            d="M 200 91 V 105 M 200 295 V 309 M 91 200 H 105 M 295 200 H 309"
            className="engine-tick"
            strokeWidth="1"
          />
          {measured ? (
            <motion.g
              initial={false}
              animate={{ rotate: needleAngle }}
              transition={{ duration: reduceMotion ? 0 : 0.6, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ transformOrigin: "200px 200px" }}
            >
              <path
                d="M200 121 V200"
                className="engine-needle"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <circle cx="200" cy="200" r="5" fill="var(--ink)" />
            </motion.g>
          ) : (
            <circle cx="200" cy="200" r="4" fill="var(--ink-muted)" />
          )}
          <text x="200" y="224" textAnchor="middle" className="engine-label">
            NET MON EXPOSURE
          </text>
          <text x="200" y="263" textAnchor="middle" className="engine-number">
            {shownDelta === null
              ? "—"
              : `${shownDelta > 0 ? "+" : ""}${(shownDelta / 100).toFixed(1)}%`}
          </text>
          <text x="200" y="287" textAnchor="middle" className="engine-label">
            TARGET ±2%
          </text>
        </svg>
      </div>

      <div className="relative z-10 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <div>
          <div
            className="font-data text-[11px] uppercase tracking-widest"
            style={{ color: "var(--exposure-long)" }}
          >
            01 / MON held
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatUsd(hedge.longExposureUsd)}
          </div>
          <p className="text-muted mt-1 text-xs">Valued using the vault&apos;s MON oracle</p>
        </div>
        <div>
          <div
            className="font-data text-[11px] uppercase tracking-widest"
            style={{ color: "var(--exposure-short)" }}
          >
            02 / MON short notional
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {hedge.shortExposureUsd === null ? "—" : formatUsd(hedge.shortExposureUsd)}
          </div>
          <p className="text-muted mt-1 text-xs">
            {illustrative ? "Illustrative short size" : `Manager reported · ${reportText}`}
          </p>
        </div>
      </div>
    </figure>
  );
}
