"use client";

import dynamic from "next/dynamic";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { formatUnits } from "viem";
import { useTheme } from "../ThemeToggle";
import type { DepositStage } from "@/lib/crosschain/progress";
import type { DepositSourceStar } from "../DepositSourceConstellation";
import StepTransition from "./StepTransition";
import { confirmedPressSteps } from "./liveProgress";
import StrategyIllustration from "./StrategyIllustration";
import art from "./concepts.module.css";
import styles from "./live.module.css";

const Scene = dynamic(() => import("./ConceptScene"), { ssr: false });
const PressContext = createContext({ paused: false, reduced: false, dark: false });

export function DepositPress({ children }: { children: ReactNode }) {
  const dark = useTheme() === "dark";
  const reduced = Boolean(useReducedMotion());
  const [paused, setPaused] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const near = useInView(host, { margin: "400px", once: true });
  return (
    <PressContext.Provider value={{ dark, paused, reduced }}>
      <div
        ref={host}
        className={`${art.root} ${dark ? art.dark : ""} ${styles.live}`}
        data-motion={paused ? "paused" : "running"}
      >
        <div className={styles.hero}>
          <div>
            <p className={art.kicker}>
              02 / YOUR MOVE <span aria-hidden="true">↘</span>
            </p>
            <h2 id="counter-action-title">
              <span className={styles.ready}>
                Ready when
                <br />
                <em>you are.</em>
              </span>
              <span className={styles.inMotion}>
                Your move.
                <br />
                <em>
                  <span className={styles.pendingTitle}>In motion.</span>
                  <span className={styles.completedTitle}>Recorded.</span>
                </em>
              </span>
            </h2>
            <p className={styles.intro}>
              Your USDC. Your share of the vault.
              <br />A considered move, from start to receipt.
            </p>
            <div className={art.signature}>
              <span>01—A</span>
              <p>
                Make your mark.<small>THE DEPOSIT PRESS</small>
              </p>
            </div>
          </div>
          <div className={`${art.art} ${styles.heroArt}`} aria-hidden="true">
            <div className={art.artOrbit} />
            <div className={`${art.scene} ${styles.heroScene}`}>
              {near && (
                <Scene
                  concept="press"
                  dark={dark}
                  paused={paused}
                  reducedMotion={reduced}
                  stage={0}
                  simulated={false}
                />
              )}
            </div>
            <span className={art.artIndex}>FIG. A / ENTRY APPARATUS</span>
            <span className={art.artNote}>PAPER. INK. INTENTION.</span>
          </div>
        </div>
        <div className={styles.motionControl}>
          <button
            type="button"
            aria-pressed={paused}
            disabled={reduced}
            onClick={() => setPaused(!paused)}
          >
            {reduced ? "Reduced motion" : paused ? "Resume motion" : "Pause motion"}
          </button>
        </div>
        {children}
      </div>
    </PressContext.Provider>
  );
}

/** Animated presentation only: the parent retains all wallet and transaction state. */
export function DepositScreenTransition({ step, children }: { step: number; children: ReactNode }) {
  const { reduced, paused } = useContext(PressContext);
  const [position, setPosition] = useState({ step, direction: 1 });
  if (position.step !== step) setPosition({ step, direction: step > position.step ? 1 : -1 });
  const intro = (
    {
      1: [
        "SOURCE",
        "Where is your USDC?",
        "One destination. Your choice of starting point. Select a source to continue.",
      ],
      2: [
        "AMOUNT",
        "What’s your move?",
        "Start with USDC. Receive a share of the whole MON vault.",
      ],
      3: [
        "REVIEW",
        "Make it yours.",
        "Your amount, your destination, your estimated shares. Review everything before signing.",
      ],
    } as Record<number, string[]>
  )[step];
  return (
    <StepTransition step={step} direction={position.direction} reduce={reduced || paused}>
      {intro ? (
        <div className={styles.stepLayout}>
          <motion.div
            className={styles.stepCopy}
            variants={{
              enter: { opacity: reduced || paused ? 1 : 0, y: reduced || paused ? 0 : 8 },
              center: { opacity: 1, y: 0 },
            }}
            transition={{
              duration: reduced || paused ? 0 : 0.3,
              delay: reduced || paused ? 0 : 0.04,
            }}
          >
            <p className={art.kicker}>{intro[0]}</p>
            <h3 data-step-heading tabIndex={-1}>
              {intro[1]}
            </h3>
            <p>{intro[2]}</p>
          </motion.div>
          <motion.div
            className={styles.stepActions}
            variants={{
              enter: { opacity: reduced || paused ? 1 : 0, y: reduced || paused ? 0 : 8 },
              center: { opacity: 1, y: 0 },
            }}
            transition={{
              duration: reduced || paused ? 0 : 0.3,
              delay: reduced || paused ? 0 : 0.09,
            }}
          >
            {children}
          </motion.div>
        </div>
      ) : (
        children
      )}
    </StepTransition>
  );
}

export function DepositPressTracking({
  stages,
  sourceName,
  autoPlayKey,
  onStrategyEnd,
  halted = false,
  children,
}: {
  stages: DepositStage[];
  sourceName: string;
  autoPlayKey?: string;
  onStrategyEnd?: () => void;
  halted?: boolean;
  children?: ReactNode;
}) {
  const { reduced, paused, dark } = useContext(PressContext);
  const failed = halted || stages.some((s) => s.state === "failed");
  const complete = stages.every((s) => s.state === "complete");
  // Only a contiguous sequence of verified milestones may feed the paper.
  const confirmedSteps = confirmedPressSteps(stages);
  const rows = stages.map((s) => [s.title.toUpperCase(), "Confirmation recorded"] as const);
  return (
    <div data-press-track data-complete={complete}>
      <div
        className={`${art.ticketBody} ${art.trackingBody} ${styles.trackingBody}`}
        data-working={!failed && !complete}
        data-motion={paused ? "paused" : "running"}
      >
        <div className={art.stepIntro}>
          <p className={art.kicker}>{complete ? "YOUR ENTRY, RECORDED" : "TRACK / YOUR DEPOSIT"}</p>
          <h3 data-step-heading tabIndex={-1}>
            {complete
              ? "A receipt worth keeping."
              : failed
                ? "Your move is on hold."
                : "Follow your move."}
          </h3>
          <p>
            {complete
              ? "Your vault shares are confirmed. Keep the transaction receipt below."
              : "Each step needs its own confirmation. Your receipt prints as those confirmations arrive."}
          </p>
          <div className={art.trackingScene}>
            <Scene
              concept="press"
              stage={4}
              dark={dark}
              paused={paused || failed}
              reducedMotion={reduced}
              working={!failed && !complete}
              complete={complete}
              confirmedSteps={confirmedSteps}
              sourceName={sourceName}
              simulated={false}
              receiptRows={rows}
            />
          </div>
          <p className={styles.caption}>
            {failed ? "PRESS ON HOLD" : `${confirmedSteps} / ${stages.length} CONFIRMED`}
            <br />
            <span>Receipt illustration · No elapsed-time estimate</span>
          </p>
        </div>
        <div className={styles.trackingActions}>
          {complete && (
            <div className={styles.receipt} role="status">
              <span className={art.kicker}>✓ VAULT RECEIPT / MONAD</span>
              <h4>sdMON received.</h4>
              <p>Your share of the pooled vault is confirmed.</p>
              <div className={art.barcode} aria-hidden="true" />
            </div>
          )}
          <ol className={art.tracking} aria-label="Deposit confirmations">
            {stages.map((s, i) => (
              <li
                key={s.title}
                data-state={s.state === "complete" ? "done" : s.state}
                aria-current={s.state === "active" ? "step" : undefined}
              >
                <span aria-hidden="true">
                  {s.state === "complete" ? "✓" : s.state === "failed" ? "!" : `0${i + 1}`}
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <p>{s.detail}</p>
                </div>
                <small>
                  {s.state === "complete"
                    ? "CONFIRMED"
                    : s.state === "active"
                      ? "AWAITING"
                      : s.state === "failed"
                        ? "ON HOLD"
                        : "UP NEXT"}
                </small>
              </li>
            ))}
          </ol>
          {children}
        </div>
      </div>
      <StrategyIllustration
        confirmed={false}
        autoPlayKey={autoPlayKey}
        onStrategyEnd={onStrategyEnd}
        paused={paused || failed}
        reducedMotion={reduced}
      />
    </div>
  );
}

export function DepositPressSources({
  sources,
  onSelect,
  loading,
}: {
  sources: DepositSourceStar[];
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  const available = sources.filter(
    (s) => s.balance === null || BigInt(s.balance) > 0n || s.fundable,
  );
  return (
    <div className={styles.sources} aria-label="USDC source networks">
      {available.map((s) => (
        <button
          type="button"
          key={s.id}
          disabled={s.balance === null}
          onClick={() => onSelect(s.id)}
        >
          <span aria-hidden="true">{s.balance === "0" ? "◇" : "◈"}</span>
          <span>
            <strong>{s.name}</strong>
            <small>
              {s.balance === null
                ? "Balance unavailable"
                : `${Number(formatUnits(BigInt(s.balance), s.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`}
              {s.error ? ` · ${s.error}` : ""}
            </small>
          </span>
          <span aria-hidden="true">↗</span>
        </button>
      ))}
      {loading ? (
        <p role="status">Checking your USDC balances…</p>
      ) : !available.length ? (
        <p>No supported USDC balance found. Fund your wallet or refresh to check again.</p>
      ) : null}
    </div>
  );
}
