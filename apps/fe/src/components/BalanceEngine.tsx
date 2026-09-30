"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { VaultStats } from "@deltamon/shared";
import { formatUsd, timeAgo } from "@/lib/format";
import { exposureReading } from "@/lib/exposureReading";
import { LONG_ARC, SHORT_ARC } from "@/lib/exposurePlateGeometry";

export function BalanceEngine({ stats }: { stats: VaultStats }) {
  const reduceMotion = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const { hedge } = stats;
  const {
    illustrative,
    measured,
    shownDelta,
    shortKnown,
    shortDrawable,
    invalidReportTime,
    futureReport,
    status,
    tone,
  } = exposureReading(stats, now);
  const scale = Math.max(hedge.longExposureUsd, hedge.shortExposureUsd ?? 0, 1);
  const longLength = hedge.longExposureUsd / scale;
  const shortLength = shortDrawable ? hedge.shortExposureUsd! / scale : 0;
  const reportText = invalidReportTime
    ? "Invalid report time"
    : futureReport
      ? "Report time is ahead of this device"
      : hedge.reportAsOf
        ? timeAgo(hedge.reportAsOf)
        : "No report received";
  const pnl = hedge.managerCapitalUsd > 0 ? hedge.managerEquityUsd - hedge.managerCapitalUsd : null;
  const pct = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(1)}%`);
  const netText =
    shownDelta === null ? "—" : `${shownDelta > 0 ? "+" : ""}${(shownDelta / 100).toFixed(1)}%`;

  return (
    <figure
      className="position-plate"
      aria-label={`Exposure plate. MON held ${formatUsd(hedge.longExposureUsd)}. Manager-reported MON short ${shortKnown ? formatUsd(hedge.shortExposureUsd!) : "unavailable"}. Net MON exposure ${shownDelta === null ? "unavailable" : `${(shownDelta / 100).toFixed(2)} percent`}. ${status}.`}
    >
      <div className="position-plate-topline">
        <span>DELTAMON / FIELD INSTRUMENT 01</span>
        <span>{illustrative ? "EXAMPLE DATA" : "MONAD VAULT DATA"}</span>
      </div>

      <div className="position-plate-header">
        <div>
          <p className="position-plate-kicker">THE COUNTERWEIGHT / CURRENT EXPOSURE</p>
          <h3>THE EXPOSURE PLATE</h3>
        </div>
        <div className="position-plate-status-block">
          <span className="position-plate-status" data-tone={tone} role="status">
            <i aria-hidden="true" /> {status}
          </span>
          <span className="position-plate-report">
            {illustrative ? "No live report in this example" : `Manager report · ${reportText}`}
          </span>
        </div>
      </div>

      <div className="position-plate-main">
        <div className="position-reading position-reading-long">
          <span className="position-reading-index">
            {illustrative ? "01 / EXAMPLE HOLDING" : "01 / ONCHAIN HOLDING"}
          </span>
          <span className="position-reading-name">MON held</span>
          <strong>{formatUsd(hedge.longExposureUsd)}</strong>
          <p>
            {illustrative ? "Illustrative MON valuation." : "Valued using the vault's MON oracle."}
          </p>
        </div>

        <div className="position-plate-graphic">
          <svg
            viewBox="0 0 520 340"
            role="img"
            aria-label={`Equal-scale curved readings: MON held ${formatUsd(hedge.longExposureUsd)}, manager-reported MON short ${shortKnown ? formatUsd(hedge.shortExposureUsd!) : "unavailable"}. ${status}.`}
          >
            <path className="position-arc-track" d={LONG_ARC} />
            <path className="position-arc-track" data-unavailable={!shortDrawable} d={SHORT_ARC} />
            <motion.path
              className="position-arc-long"
              d={LONG_ARC}
              initial={false}
              animate={{ pathLength: longLength }}
              transition={{ duration: reduceMotion ? 0 : 0.65, ease: [0.2, 0.8, 0.2, 1] }}
            />
            {shortDrawable ? (
              <motion.path
                className="position-arc-short"
                d={SHORT_ARC}
                initial={false}
                animate={{ pathLength: shortLength }}
                transition={{ duration: reduceMotion ? 0 : 0.65, ease: [0.2, 0.8, 0.2, 1] }}
              />
            ) : null}
            <path className="position-plate-axis" d="M260 73 V 286 M236 286 H284" />
            <circle className="position-plate-pivot" cx="260" cy="74" r="10" />
            <circle className="position-plate-pivot-core" cx="260" cy="74" r="3" />
            <path className="position-plate-end-mark" d="M54 275 V289 M466 275 V289" />
          </svg>
          <div className="position-net-reading">
            <span>03 / NET MON EXPOSURE</span>
            <strong>{netText}</strong>
            <small>
              {illustrative
                ? "ILLUSTRATIVE READING"
                : measured
                  ? "TARGET BAND ±2%"
                  : "NO CURRENT READING"}
            </small>
          </div>
          <div className="position-graphic-scale" aria-hidden="true">
            <span>{illustrative ? "VAULT SIDE" : "ONCHAIN"}</span>
            <span>SAME USD SCALE</span>
            <span>MANAGER REPORT</span>
          </div>
        </div>

        <div className="position-reading position-reading-short">
          <span className="position-reading-index">
            {illustrative ? "02 / EXAMPLE SHORT" : "02 / MANAGER REPORT"}
          </span>
          <span className="position-reading-name">MON short notional</span>
          <strong>{shortKnown ? formatUsd(hedge.shortExposureUsd!) : "—"}</strong>
          <p>
            {illustrative
              ? "Illustrative short size."
              : shortKnown
                ? hedge.reportAsOf
                  ? `Last reported ${reportText}.`
                  : "Report time unavailable; short size unverified."
                : "The manager has not supplied a usable short size."}
          </p>
        </div>
      </div>

      <div className="position-plate-foot">
        <div className="position-plate-provenance">
          <span className="position-provenance-mark" aria-hidden="true">
            !
          </span>
          <div>
            <strong>WHO HOLDS THE OTHER SIDE?</strong>
            <p>
              MON is held by the vault. A separate manager controls and reports the short; capital
              sent to that manager leaves the vault&apos;s direct custody.
            </p>
          </div>
        </div>
        <div className="position-plate-book">
          <span>PERP BOOK / CAPITAL ACCOUNT</span>
          <strong>{formatUsd(hedge.managerEquityUsd)}</strong>
          <p>
            {formatUsd(hedge.managerCapitalUsd)} sent to managers
            {pnl === null ? "" : ` · ${pnl >= 0 ? "+" : "−"}${formatUsd(Math.abs(pnl))}`}
          </p>
          <small>This is backing capital, not short notional.</small>
        </div>
      </div>

      {stats.yield ? (
        <figcaption className="position-plate-yield">
          <span>{illustrative ? "ILLUSTRATIVE YIELD" : "ESTIMATED YIELD"}</span>
          <strong>{pct(stats.yield.apyBps)} APY</strong>
          <span>
            Staking {pct(stats.yield.stakingAprBps)} · Funding {pct(stats.yield.fundingAprBps)}
          </span>
          <small>
            Trailing {stats.yield.windowDays}-day rates, annualized without compounding, over
            deposited USDC
            {stats.yield.principalUsd === null
              ? " (principal still indexing)."
              : ` (${formatUsd(stats.yield.principalUsd)}).`}
          </small>
        </figcaption>
      ) : null}
    </figure>
  );
}
