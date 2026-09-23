import { formatUsd, formatPrice } from "@/lib/format";
import type { VaultStats } from "@deltamon/shared";

export function HoldingsPanel({ stats }: { stats: VaultStats }) {
  const { allocation, hedge } = stats;
  const residual = Math.max(
    0,
    stats.tvlUsd - allocation.usdc.valueUsd - allocation.mon.valueUsd - hedge.managerEquityUsd,
  );
  const rows = [
    {
      name: "MON position",
      detail: `MON priced at ${formatPrice(allocation.mon.priceUsd)} by the vault oracle`,
      value: allocation.mon.valueUsd,
      color: "var(--exposure-long)",
    },
    {
      name: "USDC in vault",
      detail: "Idle cash available for exits or allocation",
      value: allocation.usdc.valueUsd,
      color: "var(--ink-muted)",
    },
    {
      name: "Manager book equity",
      detail: "Capital sent to managers, plus or minus the reported result",
      value: hedge.managerEquityUsd,
      color: "var(--exposure-short)",
    },
    ...(residual > 1
      ? [
          {
            name: "Other assets and adjustments",
            detail: "Includes AUSD and other vault accounting items",
            value: residual,
            color: "var(--ink-muted)",
          },
        ]
      : []),
  ];
  return (
    <section className="panel p-6 sm:p-8" aria-labelledby="holdings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Vault composition / 02</p>
          <h2 id="holdings-title" className="mt-2 text-2xl font-semibold">
            What your shares hold
          </h2>
        </div>
        <span className="font-data text-muted text-xs">
          {stats.source === "demo" ? "ILLUSTRATIVE ASSET MIX" : "LIVE ASSET MIX"}
        </span>
      </div>
      <div className="mt-7 space-y-5">
        {rows.map((row) => (
          <div key={row.name} className="border-line border-b pb-4 last:border-b-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: row.color }} />
                <span className="font-semibold">{row.name}</span>
              </div>
              <strong className="font-data text-sm">{formatUsd(row.value)}</strong>
            </div>
            <p className="text-muted mt-1 pl-4 text-xs">{row.detail}</p>
            <div className="bg-line/35 mt-3 ml-4 h-1 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, stats.tvlUsd ? (row.value / stats.tvlUsd) * 100 : 0)}%`,
                  background: row.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-muted mt-6 text-xs leading-relaxed">
        Asset allocation and MON exposure are different measurements. The manager may use leverage
        so a smaller amount of capital supports a short equal to the MON held. Short size comes from
        the manager report; vault holdings come from onchain reads.
      </p>
    </section>
  );
}
