import type { ReactNode } from "react";
import {
  addr,
  agoText,
  fmtBps,
  fmtMon,
  fmtPrice,
  fmtShares,
  fmtSignedUsdc,
  fmtUsdc,
  int,
  maybeBig,
  shortAddr,
  untilText,
  type VaultState,
} from "@/lib/vault";

function Reading({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="console-reading">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note ? <div className="console-reading-note">{note}</div> : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="console-detail">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ConsoleOverview({ state, ausdHeld }: { state: VaultState; ausdHeld: unknown }) {
  const book = maybeBig(state.totalAssets);
  const available = maybeBig(state.availableLiquidity);
  const coverage =
    book !== undefined && available !== undefined && book > 0n
      ? Number((available * 10_000n) / book) / 100
      : undefined;
  const coverageWidth = coverage === undefined ? 0 : Math.min(100, Math.max(0, coverage));
  const reportAt = maybeBig(state.perpReportedAt);
  const reportAge = reportAt && reportAt > 0n ? agoText(reportAt) : undefined;
  const reportIsFuture = reportAge === "future timestamp";
  const markStatus = reportIsFuture
    ? "Invalid report time"
    : reportAt === undefined || reportAt === 0n
      ? "No report"
      : state.perpReportIsStale === true
        ? "Stale report"
        : state.perpReportIsStale === false
          ? "Current report"
          : "Status unavailable";
  const oracleStatus =
    state.oracleIsLive === true
      ? "Oracle live"
      : state.oracleIsLive === false
        ? "Oracle down · in-kind exits open"
        : "Oracle status unavailable";
  const monPrice = maybeBig(state.monPrice);

  return (
    <section className="console-overview" aria-labelledby="console-overview-title">
      <div className="console-section-heading">
        <div>
          <span className="console-index">01 / THE BOOK</span>
          <h2 id="console-overview-title">Vault at a glance</h2>
        </div>
        <p>Onchain holdings, exit liquidity, and operating limits for the selected vault.</p>
      </div>

      <div className="console-overview-grid">
        <div className="console-book-panel">
          <div className="console-panel-topline">
            <span>ASSET LEDGER</span>
            <span>USDC DENOMINATED</span>
          </div>
          <div className="console-book-primary">
            <span>Total assets</span>
            <strong>
              {fmtUsdc(book)} <small>USDC</small>
            </strong>
          </div>
          <dl className="console-book-secondary">
            <Reading
              label="Price per share"
              value={fmtUsdc(maybeBig(state.pricePerShare))}
              note="USDC / sdMON"
            />
            <Reading
              label="Shares outstanding"
              value={fmtShares(maybeBig(state.totalSupply))}
              note="sdMON issued"
            />
          </dl>
          <div className="console-liquidity">
            <div className="console-liquidity-heading">
              <span>Available for exits</span>
              <strong>
                {fmtUsdc(available)} <small>USDC</small>
              </strong>
            </div>
            <div
              className="console-liquidity-track"
              role="img"
              aria-label={
                coverage === undefined
                  ? "Exit coverage unavailable"
                  : `${coverage.toFixed(2)}% of total assets available for exits`
              }
            >
              {coverage !== undefined ? <span style={{ width: `${coverageWidth}%` }} /> : null}
            </div>
            <div className="console-liquidity-foot">
              <span>
                {coverage === undefined
                  ? "Coverage unavailable"
                  : `${coverage.toFixed(2)}% of the book payable now`}
              </span>
              <span>{fmtUsdc(maybeBig(state.accruedFees))} USDC owed in fees</span>
            </div>
          </div>
        </div>

        <div className="console-holdings-panel">
          <div className="console-panel-topline">
            <span>POSITION READINGS</span>
            <span>ONCHAIN + REPORTED</span>
          </div>
          <dl className="console-holdings-grid">
            <Reading label="Idle USDC" value={fmtUsdc(maybeBig(state.usdcBalance))} />
            <Reading
              label="MON held"
              value={fmtMon(maybeBig(state.totalMon))}
              note={`${fmtMon(maybeBig(state.stakedMon))} staked · ${fmtMon(maybeBig(state.unstakingMon))} unbonding`}
            />
            <Reading
              label="MON oracle price"
              value={monPrice === undefined ? "—" : `$${fmtPrice(monPrice)}`}
              note={oracleStatus}
            />
            <Reading
              label="AUSD held"
              value={fmtUsdc(typeof ausdHeld === "bigint" ? ausdHeld : undefined)}
            />
          </dl>
          <div className="console-report">
            <div>
              <span className="console-report-label">PERP BOOK · MANAGER MARK</span>
              <strong>
                {fmtUsdc(maybeBig(state.perpEquity))} <small>USDC equity</small>
              </strong>
            </div>
            <span
              className={`console-report-status ${markStatus === "Current report" ? "is-current" : ""}`}
            >
              {markStatus}
            </span>
            <p>
              {fmtUsdc(maybeBig(state.perpDeployed))} USDC sent ·{" "}
              {fmtSignedUsdc(maybeBig(state.perpReportedPnl))} USDC reported P&amp;L
            </p>
            <p className="console-report-trust">
              Manager reported, not a vault-held short.{" "}
              {reportIsFuture
                ? "Report timestamp is in the future."
                : reportAt && reportAt > 0n
                  ? `Marked ${reportAge}.`
                  : "No mark recorded."}
            </p>
          </div>
        </div>
      </div>

      <div className="console-parameters">
        <div className="console-parameters-heading">
          <div>
            <span className="console-index">02 / PARAMETERS</span>
            <h3>Settings &amp; roles</h3>
          </div>
          <p>Current contract configuration</p>
        </div>
        <dl className="console-detail-grid">
          <Detail label="Deposit cap" value={`${fmtUsdc(maybeBig(state.depositCap))} USDC`} />
          <Detail label="Minimum deposit" value={`${fmtUsdc(maybeBig(state.minDeposit))} USDC`} />
          <Detail
            label="Performance fee"
            value={
              state.performanceFeeBps === undefined ? "—" : fmtBps(int(state.performanceFeeBps))
            }
          />
          <Detail
            label="Perp ceiling"
            value={
              state.maxPerpAllocationBps === undefined
                ? "—"
                : fmtBps(int(state.maxPerpAllocationBps))
            }
          />
          <Detail
            label="Swap slippage cap"
            value={
              state.maxSwapSlippageBps === undefined ? "—" : fmtBps(int(state.maxSwapSlippageBps))
            }
          />
          <Detail
            label="Vault state"
            value={state.paused === undefined ? "—" : state.paused === true ? "Paused" : "Active"}
          />
          <Detail
            label="Whitelist"
            value={
              state.whitelistEnabled === undefined
                ? "—"
                : state.whitelistEnabled === true
                  ? "On"
                  : "Off"
            }
          />
          <Detail
            label="Admin"
            value={<span className="font-data">{shortAddr(addr(state.owner))}</span>}
          />
          <Detail
            label="Keeper"
            value={<span className="font-data">{shortAddr(addr(state.keeper))}</span>}
          />
        </dl>
        <div className="console-pending">
          <span>QUEUED CHANGES</span>
          <p>
            Fee {untilText(maybeBig(state.pendingFeeEffectiveAt))} · Perp ceiling{" "}
            {untilText(maybeBig(state.pendingMaxPerpAllocationAt))} · Risk limit{" "}
            {untilText(maybeBig(state.pendingRiskParamsAt))} · Venue{" "}
            {untilText(maybeBig(state.venueEffectiveAt))}
          </p>
        </div>
      </div>
    </section>
  );
}
