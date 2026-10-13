"use client";

import { useId, useState } from "react";
import type { VaultAccountingHistory, VaultStats } from "@deltamon/shared";
import { useVaultHistory } from "@/hooks/useVaultHistory";
import { formatUsd } from "@/lib/format";
import {
  compositionSlices,
  coverageLabel,
  fundingValue,
  historyDate,
  historyMatchesVault,
  historyUsd,
  historyPercent,
  strategyReturn,
  trimToRecorded,
  settledBefore,
  incomeValue,
  cumulativeIncome,
  type FundingView,
} from "@/lib/vaultHistory";
import { IncomeChart, ReturnChart } from "./PerformanceCharts";

function recordedAt(value: string): string {
  return `${historyDate(value)} · ${new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

function CapitalComposition({ history }: { history: VaultAccountingHistory | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null);
  const composition = history ? compositionSlices(history) : null;
  const activeId = hovered?.id ?? selected;
  const active = composition?.slices.find((slice) => slice.id === activeId);
  const hoveredSlice = composition?.slices.find((slice) => slice.id === hovered?.id);
  const value = active?.value ?? composition?.total ?? null;
  const label = active?.label ?? "Gross assets";
  const ringLength = 2 * Math.PI * 76;
  let offset = 0;
  const chartable = composition?.chartable && composition.total > 0;
  const stake = history?.latest?.stakedMon;
  return (
    <div className="performance-composition" id="vault-composition">
      <h4 className="performance-kicker">02 / Capital composition</h4>
      <div className="performance-ring-wrap">
        <svg
          viewBox="0 0 190 190"
          role="img"
          onPointerMove={(event) => {
            if (!chartable) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - bounds.left) / bounds.width) * 190 - 95;
            const y = ((event.clientY - bounds.top) / bounds.height) * 190 - 95;
            const radius = Math.hypot(x, y);
            if (radius < 65 || radius > 87) {
              setHovered(null);
              return;
            }
            // Resolve by angle so even tiny slices are inspectable without overlapping SVG hits.
            const fraction =
              ((Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
            let end = 0;
            const slice = composition.slices.find((slice) => {
              end += slice.value / composition.total;
              return slice.value > 0 && fraction < end;
            });
            setHovered(
              slice
                ? {
                    id: slice.id,
                    x: event.clientX - bounds.left,
                    y: event.clientY - bounds.top,
                  }
                : null,
            );
          }}
          onPointerLeave={() => setHovered(null)}
          aria-label={
            chartable
              ? `Gross asset composition: ${composition.slices.map((slice) => `${slice.label} ${historyUsd(slice.value)}`).join(", ")}. Short-account equity is capital, not short notional.`
              : "Capital composition is not available to chart."
          }
        >
          <circle
            cx={95}
            cy={95}
            r={76}
            fill="none"
            stroke="var(--line)"
            strokeWidth={22}
            opacity={0.25}
          />
          {chartable &&
            composition.slices.map((slice) => {
              const length = (slice.value / composition.total) * ringLength;
              const start = offset;
              offset += length;
              if (length <= 0) return null;
              const gap =
                composition.slices.filter((slice) => slice.value > 0).length > 1
                  ? Math.min(3, length / 5)
                  : 0;
              return (
                <circle
                  key={slice.id}
                  className="performance-ring-slice"
                  cx={95}
                  cy={95}
                  r={76}
                  fill="none"
                  stroke={`var(--performance-${slice.id})`}
                  strokeWidth={22}
                  strokeDasharray={`${length - gap} ${ringLength - length + gap}`}
                  strokeDashoffset={-start - gap / 2}
                  transform="rotate(-90 95 95)"
                  opacity={activeId && activeId !== slice.id ? 0.25 : 1}
                />
              );
            })}
        </svg>
        <div className="performance-ring-center" aria-hidden="true">
          <strong>
            {value !== null && composition?.chartable
              ? value >= 10000
                ? formatUsd(value, { compact: true })
                : historyUsd(value)
              : "—"}
          </strong>
          <span>{label}</span>
        </div>
        {hovered && hoveredSlice && chartable && (
          <div
            className="performance-ring-tooltip"
            style={{ left: hovered.x, top: hovered.y }}
            aria-hidden="true"
          >
            <span>
              <i
                className="performance-swatch"
                style={{ background: `var(--performance-${hoveredSlice.id})` }}
              />
              {hoveredSlice.label}
            </span>
            <strong>{historyUsd(hoveredSlice.value)}</strong>
            <small>
              {((hoveredSlice.value / composition.total) * 100).toFixed(1)}% of gross assets
            </small>
          </div>
        )}
      </div>
      {composition ? (
        <div className="performance-asset-ledger" aria-label="Inspect capital composition">
          {composition.slices.map((slice) => (
            <button
              type="button"
              key={slice.id}
              aria-pressed={selected === slice.id}
              onClick={() => setSelected(selected === slice.id ? null : slice.id)}
            >
              <i
                className="performance-swatch"
                style={{ background: `var(--performance-${slice.id})` }}
                aria-hidden="true"
              />
              <span>
                {slice.label}
                <small>
                  {composition.chartable && composition.total > 0
                    ? `${((slice.value / composition.total) * 100).toFixed(1)}% of gross assets`
                    : "Recorded asset value"}
                </small>
              </span>
              <strong>{historyUsd(slice.value)}</strong>
            </button>
          ))}
        </div>
      ) : (
        <p className="performance-caption performance-composition-empty">
          A recorded asset mix will appear here.
        </p>
      )}
      <div className="performance-composition-note">
        {history?.composition ? (
          <>
            {stake !== undefined && (
              <p>
                <span className="performance-swatch" data-source="staking" aria-hidden="true" />
                {new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(stake)} MON
                staked
              </p>
            )}
            <p>
              Accrued fee liability{" "}
              <strong>{historyUsd(history.composition.accruedFeesUsd)}</strong>
            </p>
            <p>
              Snapshot {recordedAt(history.composition.at)}
              {!history.composition.shortBookFresh && (
                <span className="performance-warning"> · Short report stale</span>
              )}
            </p>
            {!composition?.chartable && (
              <p className="performance-warning">This asset mix cannot be represented as a pie.</p>
            )}
          </>
        ) : (
          <p>
            Holdings and short-account equity.
            <br />
            Short notional is exposure, not a slice of capital.
          </p>
        )}
      </div>
    </div>
  );
}

export function VaultPerformance({ stats }: { stats: VaultStats | null }) {
  const [period, setPeriod] = useState(30);
  const [fundingView, setFundingView] = useState<FundingView>("observed");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const sliderId = useId();
  const query = useVaultHistory(period);
  const mismatched =
    query.data?.status !== "not_configured" &&
    query.data &&
    !historyMatchesVault(query.data, stats);
  const history = mismatched ? null : (query.data ?? null);
  // Keep the recorded asset mix stable while switching periods, but never label old dates as
  // the newly requested period. Income readings wait for the matching response.
  const allDays = query.isPlaceholderData ? [] : (history?.daily ?? []);
  // Framing only: an empty run before the first reading would squeeze the record into the margin.
  const days = trimToRecorded(allDays);
  const trimmed = allDays.length - days.length;
  const earlier = settledBefore(allDays);
  const selectedIndex = Math.max(
    0,
    selectedDate ? days.findIndex((day) => day.date === selectedDate) : days.length - 1,
  );
  const selected = days[selectedIndex];
  const cumulative = cumulativeIncome(days);
  const lastIncome = cumulative.findLast((point) => point !== null);
  const lastReading = days.findLast((day) => day.snapshotAt !== null);
  // The vault's own value, already read on-chain in every snapshot. No deposit history needed.
  const vaultValue = history?.latest?.netAssetsUsd ?? null;
  const strategyPoints = strategyReturn(days, vaultValue, fundingView);
  const lastStrategy = strategyPoints.findLast((point) => point !== null) ?? null;
  const returnCount = strategyPoints.filter((point) => point !== null).length;
  const selectDay = (index: number) => setSelectedDate(days[index]?.date ?? null);
  const rate = history?.latest?.stakingApyBps;
  const message = mismatched
    ? "The saved history belongs to a different vault."
    : query.isError
      ? history
        ? "Showing saved readings. The latest refresh is unavailable."
        : "Historical readings are unavailable right now."
      : history?.status === "not_configured"
        ? "Historical readings are not available for this vault yet."
        : query.isPlaceholderData
          ? "Updating the period."
          : query.isPending
            ? "Reading the vault’s history."
            : history?.status === "collecting"
              ? "The first observations are being recorded."
              : null;

  return (
    <section
      className="performance-field"
      aria-labelledby="performance-title"
      aria-busy={query.isFetching}
    >
      <div className="performance-rail">
        <span>DELTAMON / STRATEGY 01</span>
        <span>
          {history?.latest
            ? `RECORD SAVED ${recordedAt(history.latest.at)}`
            : "THE PERFORMANCE RECORD"}
        </span>
      </div>
      <div className="performance-heading">
        <h3 id="performance-title">
          A record of
          <br />
          <em>capital at work.</em>
        </h3>
        <div className="performance-period" role="group" aria-label="Performance period">
          {[7, 30].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => {
                setPeriod(value);
                setSelectedDate(null);
              }}
            >
              {value}D
            </button>
          ))}
        </div>
      </div>
      {message && (
        <div className="performance-notice" role="status">
          <p>{message}</p>
          {(query.isError || mismatched) && (
            <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
              {query.isFetching ? "Refreshing…" : "Try again ↗"}
            </button>
          )}
        </div>
      )}
      <div className="performance-grid">
        <div className="performance-return">
          <h4 className="performance-kicker">01 / Cumulative vault return</h4>
          <p
            className="performance-number"
            data-negative={lastStrategy !== null && lastStrategy.value < 0}
          >
            {historyPercent(lastStrategy?.value ?? null)}
          </p>
          <p className="performance-caption">
            {query.isPending || query.isPlaceholderData ? (
              `Fetching the ${period}-day record`
            ) : vaultValue === null ? (
              "Awaiting the first recorded vault reading"
            ) : (
              <>
                Funding and staking income earned on vault value · {returnCount} recorded{" "}
                {returnCount === 1 ? "day" : "days"}
              </>
            )}
          </p>
          <div className="performance-cumulative-sources">
            <span>
              Vault value <strong>{historyUsd(vaultValue)}</strong>
            </span>
            <span>
              Income earned <strong>{historyUsd(lastStrategy?.incomeUsd ?? null, true)}</strong>
            </span>
          </div>
          <ReturnChart
            days={days}
            points={strategyPoints}
            selected={selectedIndex}
            onSelect={selectDay}
          />
          <p className="performance-chart-note">
            {vaultValue === null
              ? "No vault reading has been recorded yet."
              : "Funding plus estimated staking over the vault's USDC value. Excludes price PnL and trading fees, so it is strategy income, not a depositor's net return."}
            {lastReading?.shortBookFresh === false
              ? " The latest short report was stale; funding accrual may lag."
              : ""}
            {lastStrategy?.partial ? " Partial coverage; unrecorded income is excluded." : ""}
            {trimmed > 0
              ? ` The axis starts at the first recorded day; ${trimmed} earlier ${trimmed === 1 ? "day has" : "days have"} nothing to plot.`
              : ""}
            {earlier
              ? ` Before that, ${historyUsd(earlier.funding, true)} of funding settled and ${historyUsd(earlier.fees)} of fees were charged.`
              : ""}
          </p>
        </div>
        <CapitalComposition history={history} />
      </div>
      <div className="performance-income">
        <div className="performance-income-heading">
          <h4 className="performance-kicker">03 / Daily strategy income · USD</h4>
          <div className="performance-funding-view" role="group" aria-label="Funding measurement">
            <button
              type="button"
              aria-pressed={fundingView === "observed"}
              onClick={() => setFundingView("observed")}
            >
              Observed
            </button>
            <button
              type="button"
              aria-pressed={fundingView === "settled"}
              onClick={() => setFundingView("settled")}
            >
              Settled
            </button>
          </div>
        </div>
        <div className="performance-income-meta">
          <div className="performance-legend">
            <span>
              <i className="performance-swatch" data-source="staking" aria-hidden="true" />
              Staking · estimated
            </span>
            <span>
              <i className="performance-swatch" data-source="funding" aria-hidden="true" />
              Funding · {fundingView === "observed" ? "observed" : "settled"}
            </span>
            <span>
              <i className="performance-partial-key" aria-hidden="true" />
              Partial day
            </span>
          </div>
          <p>
            {fundingView === "observed"
              ? "Change in funding earned, including unpaid accrual."
              : "Funding booked when the short position settles."}
          </p>
        </div>
        <div className="performance-cumulative-sources">
          <span>
            Recorded funding total <strong>{historyUsd(lastIncome?.funding ?? null, true)}</strong>
          </span>
          <span>
            Staking estimate total <strong>{historyUsd(lastIncome?.staking ?? null, true)}</strong>
          </span>
        </div>
        <p className="performance-chart-note">
          Totals include only days with both recorded earned funding and estimated staking.
          {rate !== null && rate !== undefined
            ? ` Latest staking assumption: ${rate / 100}% APY.`
            : ""}
          {lastIncome?.partial ? " Partial coverage; unrecorded income is excluded." : ""}
        </p>
        <IncomeChart days={days} selected={selectedIndex} onSelect={selectDay} view={fundingView} />
      </div>
      <div className="performance-readout" aria-live="polite" aria-atomic="true">
        <span className="performance-inspected-date">
          {selected ? historyDate(selected.date).toUpperCase() : "NO RECORDED DATE"}
          <small>
            {selected?.partial
              ? "Partial record"
              : selected
                ? "Recorded day"
                : "Awaiting observations"}
          </small>
        </span>
        <dl>
          <div>
            <dt>Vault return</dt>
            <dd data-negative={(strategyPoints[selectedIndex]?.value ?? 0) < 0}>
              {historyPercent(strategyPoints[selectedIndex]?.value ?? null)}
            </dd>
            <span>Income earned over deposited capital</span>
          </div>
          <div>
            <dt>Staking estimate</dt>
            <dd>{historyUsd(selected?.stakingEstimatedUsd ?? null, true)}</dd>
            <span>
              {selected && selected.stakingEstimatedUsd !== null
                ? coverageLabel(selected.stakingCoveredSeconds)
                : "No observation"}
            </span>
          </div>
          <div>
            <dt>Funding {fundingView}</dt>
            <dd data-negative={selected && (fundingValue(selected, fundingView) ?? 0) < 0}>
              {historyUsd(selected ? fundingValue(selected, fundingView) : null, true)}
            </dd>
            <span>
              {selected && fundingValue(selected, fundingView) !== null
                ? fundingView === "observed"
                  ? coverageLabel(selected.fundingObservedSeconds)
                  : "Venue payments"
                : "No observation"}
            </span>
          </div>
          <div>
            <dt>{fundingView === "observed" ? "Combined income*" : "Staking + settled*"}</dt>
            <dd>{historyUsd(selected ? incomeValue(selected, fundingView) : null, true)}</dd>
            <span>Excludes price PnL &amp; fees</span>
          </div>
        </dl>
      </div>
      <label className="performance-scrub" htmlFor={sliderId}>
        <span>Inspect date</span>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={Math.max(0, days.length - 1)}
          step={1}
          value={selectedIndex}
          disabled={days.length === 0}
          onChange={(event) => selectDay(Number(event.target.value))}
          aria-valuetext={
            selected
              ? `${historyDate(selected.date)}, ${selected.partial ? "partial record" : "recorded day"}`
              : "No recorded dates"
          }
        />
        <span>{selected ? historyDate(selected.date) : "—"}</span>
      </label>
      <div className="performance-footnote">
        <span>UTC DAILY RECORD</span>
        <p>
          The return chart tracks funding and staking income against deposited capital. Gaps are
          days with no recorded income. Hatched income bars cover part of a day. *Daily combined
          income adds funding and estimated staking, excluding price gains/losses and fees.
        </p>
      </div>
      <details className="performance-method">
        <summary>
          <span>Sources &amp; accounting notes</span>
          <span aria-hidden="true">+</span>
        </summary>
        <div className="performance-method-grid">
          <div>
            <h5>Vault return</h5>
            <p>
              Calculated as (funding plus estimated staking earned to date / the vault&apos;s total
              value in USDC) × 100. Deposits are capital, not income. It measures what the strategy
              has produced on the money at work, and excludes MON price gains and losses, short
              re-marks and trading fees, so it is strategy income rather than a depositor&apos;s net
              return. Your own return depends on your entry date and redemption fee. Book value per
              share is a separate reading: it only picks up staking rewards once they are claimed
              and funding once it settles, so it can fall on a day the strategy earned.
            </p>
          </div>
          <div>
            <h5>Estimated staking</h5>
            <p>
              Calculated from recorded staked MON and the annual yield assumption saved with each
              observation.
              {rate !== null && rate !== undefined
                ? ` The latest assumption is ${rate / 100}% APY.`
                : " No staking rate has been recorded yet."}{" "}
              Only estimated reward MON is valued at each recorded interval’s MON price; price
              changes on existing MON holdings are excluded. Estimated rewards do not change vault
              NAV.
            </p>
          </div>
          <div>
            <h5>Actual funding</h5>
            <p>
              Observed funding includes settled payments and changes in unpaid funding. Settled
              shows the venue’s recorded payments, including backfilled history. Funding paid by the
              vault is negative.
              {history?.perpl.historyComplete === false
                ? " Funding history is still being collected."
                : ""}
            </p>
          </div>
          <div>
            <h5>Composition &amp; costs</h5>
            <p>
              MON holdings include staked, idle and unstaking MON. Short-account equity is its
              booked capital, not short notional. Accrued fees are a separate liability.
            </p>
            <p className="performance-cost-reading">
              {selected
                ? `Fill fees ${historyUsd(selected.tradingFeesUsd)} · Realised price PnL ${historyUsd(selected.realisedTradingPnlUsd, true)} · ${historyDate(selected.date)}`
                : "Fee and price-PnL readings appear with recorded dates."}
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}
