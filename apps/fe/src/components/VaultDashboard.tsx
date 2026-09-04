"use client";

import { BalanceBeam } from "./BalanceBeam";
import { StatsRow } from "./StatsRow";
import { YieldBreakdown } from "./YieldBreakdown";
import { DepositPanel } from "./DepositPanel";
import { useVaultStats } from "@/hooks/useVaultStats";

export function VaultDashboard() {
  const { stats, isLive, isOffline } = useVaultStats();

  return (
    <section className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      <div className="border-line bg-surface rounded-2xl border p-5 sm:p-8">
        <BalanceBeam
          long={stats.legs.long}
          short={stats.legs.short}
          netDeltaBps={stats.netDeltaBps}
        />
        {!isLive ? (
          <p className="text-muted mt-4 text-center text-xs">
            {isOffline
              ? "Backend offline — showing demo data."
              : "Demo data until the vault is deployed."}
          </p>
        ) : null}
      </div>

      <div className="mt-8">
        <StatsRow stats={stats} />
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <DepositPanel />
        <YieldBreakdown apy={stats.apy} />
      </div>
    </section>
  );
}
