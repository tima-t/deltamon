"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { motion, useReducedMotion } from "motion/react";

export interface DepositSourceStar {
  id: string;
  name: string;
  balance: string | null;
  decimals: number;
  error?: string;
  fundable?: boolean;
}

function units(source: DepositSourceStar): number {
  if (source.balance === null) return 0;
  const value = Number(formatUnits(BigInt(source.balance), source.decimals));
  return Number.isFinite(value) ? value : 0;
}

function formatBalance(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
  });
}

function formatShare(value: number): string {
  if (value > 0 && value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

export function DepositSelectedSource({ source }: { source: DepositSourceStar }) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="deposit-selected-source" aria-label={`Selected source: ${source.name}`}>
      <motion.span
        layoutId={`deposit-source-star-${source.id}`}
        className="deposit-selected-source-core"
        transition={{ layout: { type: "spring", duration: reduceMotion ? 0 : 0.48, bounce: 0 } }}
        aria-hidden="true"
      >
        {source.name.slice(0, 1)}
      </motion.span>
      <span>
        SOURCE LOCKED <strong>{source.name}</strong>
      </span>
      <span className="deposit-selected-source-arrow" aria-hidden="true">
        ↘
      </span>
    </div>
  );
}

export function DepositSourceConstellation({
  sources,
  selectedId,
  onSelect,
  loading = false,
}: {
  sources: DepositSourceStar[];
  selectedId?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [motionOn, setMotionOn] = useState(true);
  const readable = sources.filter((source) => source.balance !== null);
  const funded = readable.filter((source) => units(source) > 0);
  const zero = readable.filter((source) => units(source) === 0 && source.fundable);
  const unavailable = sources.filter((source) => source.balance === null);
  const visible = [...funded, ...zero];
  const total = funded.reduce((sum, source) => sum + units(source), 0);
  const maxBalance = Math.max(0, ...funded.map(units));
  const density = visible.length > 6 ? "many" : visible.length > 3 ? "several" : "few";
  const maxDiameter = density === "many" ? 70 : density === "several" ? 92 : 112;
  const playMotion = motionOn && !reduceMotion;

  return (
    <section className="deposit-constellation" aria-label="Choose a USDC source chain">
      <div className="deposit-constellation-topline">
        <span>YOUR USDC / SOURCE CONSTELLATION</span>
        {!reduceMotion ? (
          <button
            type="button"
            onClick={() => setMotionOn((value) => !value)}
            aria-pressed={!motionOn}
          >
            {motionOn ? "PAUSE MOTION" : "RESUME MOTION"}
          </button>
        ) : (
          <span>MOTION REDUCED</span>
        )}
      </div>
      <div className="deposit-constellation-sky" data-motion={playMotion ? "on" : "off"}>
        <div
          className="deposit-constellation-grid"
          data-density={density}
          data-count={visible.length}
        >
          {visible.map((source, index) => {
            const balance = units(source);
            const isZero = balance === 0;
            const share = total > 0 ? (balance / total) * 100 : 0;
            const diameter = isZero
              ? 30
              : Math.max(10, maxDiameter * Math.sqrt(balance / maxBalance));
            return (
              <button
                key={source.id}
                type="button"
                className="deposit-constellation-choice"
                data-zero={isZero}
                data-small={diameter < 38}
                aria-pressed={selectedId === source.id}
                aria-label={`${source.name}, ${formatBalance(balance)} USDC${isZero ? ", ready to fund" : `, ${formatShare(share)} of known USDC`}`}
                onClick={() => onSelect(source.id)}
                style={{ "--star-diameter": `${diameter}px` } as React.CSSProperties}
              >
                <span className="deposit-constellation-scope" aria-hidden="true">
                  <span className="deposit-constellation-orbit" />
                  <motion.span
                    layoutId={`deposit-source-star-${source.id}`}
                    className="deposit-constellation-star"
                    transition={{
                      layout: { type: "spring", duration: reduceMotion ? 0 : 0.48, bounce: 0 },
                    }}
                  >
                    {isZero ? "+" : source.name.slice(0, 1)}
                  </motion.span>
                  <span className="deposit-constellation-crosshair" />
                </span>
                <span className="deposit-constellation-name">
                  <span className="deposit-constellation-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>{" "}
                  {source.name}
                </span>
                <span className="deposit-constellation-balance">
                  {formatBalance(balance)} USDC{" "}
                  <small>{isZero ? "FUND" : formatShare(share)}</small>
                </span>
              </button>
            );
          })}
          {visible.length === 0 ? (
            <p className="deposit-constellation-empty">
              {loading ? "Scanning supported chains…" : "No readable USDC balances found."}
            </p>
          ) : null}
        </div>
      </div>
      <div className="deposit-constellation-foot">
        <span>STAR SIZE TRACKS READABLE USDC</span>
        <span>{loading ? "UPDATING…" : `${formatBalance(total)} USDC KNOWN`}</span>
      </div>
      {unavailable.length > 0 ? (
        <div className="deposit-constellation-unavailable">
          {unavailable.map((source) => (
            <div key={source.id}>
              <span>{source.name}</span>
              <span>{source.error ?? "Balance unavailable"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
