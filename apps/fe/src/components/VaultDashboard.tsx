"use client";

import Link from "next/link";
import { BalanceEngine } from "./BalanceEngine";
import { StatsRow } from "./StatsRow";
import { HoldingsPanel } from "./HoldingsPanel";
import { DepositPanel } from "./DepositPanel";
import { PositionPanel } from "./PositionPanel";
import { useVaultStats } from "@/hooks/useVaultStats";

export function VaultDashboard() {
  const { stats, isOffline, isLoading } = useVaultStats();
  return (
    <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
      <section className="hero-grid py-12 sm:py-20">
        <div>
          <p className="eyebrow">The Monad vault / built to show its work</p>
          <h1 className="hero-title mt-6">
            Put MON to work. <em>See the balance.</em>
          </h1>
          <p className="text-muted mt-7 max-w-xl text-lg leading-relaxed">
            Deposit USDC for sdMON shares. The vault holds MON and backs a manager-run short,
            targeting low net MON exposure while putting capital to work.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#deposit"
              className="button-primary inline-flex min-h-12 items-center rounded-xl px-6 font-semibold"
            >
              Explore deposit{" "}
              <span className="ml-3" aria-hidden="true">
                ↗
              </span>
            </a>
            <a
              href="#how"
              className="button-secondary inline-flex min-h-12 items-center rounded-xl px-5 font-semibold"
            >
              How it balances
            </a>
          </div>
          <div className="border-line mt-10 grid max-w-lg grid-cols-3 gap-4 border-t pt-5">
            <div>
              <span className="metric-label">Network</span>
              <p className="mt-2 text-sm font-semibold">Monad</p>
            </div>
            <div>
              <span className="metric-label">Vault share</span>
              <p className="mt-2 text-sm font-semibold">sdMON</p>
            </div>
            <div>
              <span className="metric-label">Target band</span>
              <p className="mt-2 text-sm font-semibold">±2% net</p>
            </div>
          </div>
        </div>
        {stats ? (
          <BalanceEngine stats={stats} />
        ) : (
          <div
            className="instrument-card flex min-h-[500px] flex-col items-center justify-center p-8 text-center"
            role="status"
          >
            <div className="mb-5 size-20 rounded-full border-8 border-line border-t-monad" />
            <h2 className="text-2xl font-semibold">
              {isOffline ? "Live readings unavailable" : "Reading the vault"}
            </h2>
            <p className="text-muted mt-3 max-w-sm text-sm">
              {isOffline
                ? "The vault API did not respond. No demo figures are being shown as live data."
                : "Fetching onchain holdings and the manager position report."}
            </p>
            {isLoading ? (
              <span className="font-data text-muted mt-4 text-xs">CONNECTING TO MONAD</span>
            ) : null}
          </div>
        )}
      </section>

      {stats ? (
        <section id="vault" className="pb-12">
          <StatsRow stats={stats} />
          {stats.source === "demo" ? (
            <p className="mt-4 text-xs font-medium" style={{ color: "var(--exposure-short)" }}>
              Illustrative data until the backend points at a deployed vault and receives a manager
              position report.
            </p>
          ) : null}
        </section>
      ) : null}
      <div className="grid gap-6 pb-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
        <div id="deposit" className="min-w-0">
          <DepositPanel />
        </div>
        {stats ? (
          <HoldingsPanel stats={stats} />
        ) : (
          <div className="panel flex items-center p-8">
            <p className="text-muted text-sm">
              Vault holdings are unavailable from the API right now. Wallet actions remain
              accessible.
            </p>
          </div>
        )}
      </div>
      <section id="position" className="pb-16">
        <PositionPanel />
      </section>
      <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t py-7 text-sm">
        <p className="text-muted">Inspect the underlying vault and all operational controls.</p>
        <Link href="/console" className="text-monad font-semibold underline underline-offset-4">
          Open vault console ↗
        </Link>
      </div>
    </div>
  );
}
