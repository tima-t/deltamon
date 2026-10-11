"use client";

import { useEffect, useId, useState } from "react";
import type { VaultStats } from "@deltamon/shared";
import { formatUsd, timeAgo } from "@/lib/format";
import { exposureReading } from "@/lib/exposureReading";

export function HedgeStatus({ stats }: { stats: VaultStats }) {
  const headingId = useId();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const { hedge } = stats;
  const reading = exposureReading(stats, now);
  const { illustrative, measured, shownDelta, shortKnown, shortDrawable, status, tone } = reading;
  const scale = Math.max(hedge.longExposureUsd, hedge.shortExposureUsd ?? 0, 1);
  const reportText = reading.invalidReportTime
    ? "Invalid report time"
    : reading.futureReport
      ? "Report time is ahead of this device"
      : hedge.reportAsOf
        ? timeAgo(hedge.reportAsOf)
        : "No report received";
  const reportTimestamp =
    hedge.reportAsOf && !reading.invalidReportTime
      ? new Date(hedge.reportAsOf).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"
      : undefined;
  const netText =
    shownDelta === null ? "—" : `${shownDelta > 0 ? "+" : ""}${(shownDelta / 100).toFixed(1)}%`;

  return (
    <section className="hedge-strip" aria-labelledby={headingId}>
      <div className="hedge-strip-header">
        <h3 id={headingId}>Hedge status</h3>
        <div className="hedge-strip-report">
          <span className="hedge-strip-status" data-tone={tone} role="status">
            <i aria-hidden="true" />
            {status}
          </span>
          <span title={reportTimestamp}>
            {illustrative ? "Example data · no live report" : `Short report · ${reportText}`}
          </span>
        </div>
      </div>
      <dl className="hedge-strip-readings">
        <div data-leg="long">
          <dt>
            <i aria-hidden="true" />
            MON held
          </dt>
          <dd className="hedge-strip-value">{formatUsd(hedge.longExposureUsd)}</dd>
          <dd className="hedge-strip-meter" aria-hidden="true">
            <span style={{ width: `${(hedge.longExposureUsd / scale) * 100}%` }} />
          </dd>
          <dd className="hedge-strip-hint">
            {illustrative ? "Example holdings" : "Onchain holdings · oracle value"}
          </dd>
        </div>
        <div data-leg="short">
          <dt>
            <i aria-hidden="true" />
            Reported MON short
          </dt>
          <dd className="hedge-strip-value">
            {shortKnown ? formatUsd(hedge.shortExposureUsd!) : "—"}
          </dd>
          <dd className="hedge-strip-meter" data-unavailable={!shortDrawable} aria-hidden="true">
            {shortDrawable && (
              <span style={{ width: `${(hedge.shortExposureUsd! / scale) * 100}%` }} />
            )}
          </dd>
          <dd className="hedge-strip-hint">
            {illustrative
              ? "Example position notional"
              : measured
                ? "Position notional · same USD scale"
                : shortKnown
                  ? "Last reported notional · unverified"
                  : "Position notional unavailable"}
          </dd>
        </div>
        <div data-leg="net">
          <dt>Net MON exposure</dt>
          <dd className="hedge-strip-value" data-tone={tone}>
            {netText}
          </dd>
          <dd className="hedge-strip-hint">
            {illustrative
              ? "Illustrative reading"
              : measured
                ? "Of vault value · target ±2%"
                : "Awaiting a current short report"}
          </dd>
        </div>
      </dl>
      <dl className="hedge-strip-account">
        <div>
          <dt>Vault value</dt>
          <dd>{formatUsd(stats.tvlUsd)}</dd>
        </div>
        <div>
          <dt>Share price</dt>
          <dd>{stats.shareToken.pricePerShare.toFixed(4)} USDC</dd>
        </div>
        {stats.depositCapUsd !== null && (
          <div>
            <dt>Deposit cap</dt>
            <dd>{formatUsd(stats.depositCapUsd, { compact: true })}</dd>
          </div>
        )}
      </dl>
      <p className="hedge-strip-custody">
        <strong>Separate short account.</strong> Funds backing the short are outside the vault’s
        direct control. Its reported position may be delayed or inaccurate; backing capital is shown
        in the composition below.
      </p>
    </section>
  );
}
