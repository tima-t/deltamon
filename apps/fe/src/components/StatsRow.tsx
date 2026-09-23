import { formatUsd } from "@/lib/format";
import type { VaultStats } from "@deltamon/shared";

export function StatsRow({ stats }: { stats: VaultStats }) {
  const items = [
    {
      label: "Vault value",
      value: formatUsd(stats.tvlUsd, { compact: true }),
      hint: stats.depositCapUsd
        ? `Deposit cap ${formatUsd(stats.depositCapUsd, { compact: true })}`
        : "Onchain vault value",
    },
    {
      label: "Share price",
      value: `${stats.shareToken.pricePerShare.toFixed(4)}`,
      hint: "USDC per sdMON",
    },
    {
      label: "MON allocation",
      value: `${(stats.allocation.monShareBps / 100).toFixed(1)}%`,
      hint: "Actual share of vault value",
    },
    {
      label: "Capital with manager",
      value: formatUsd(stats.hedge.managerCapitalUsd, { compact: true }),
      hint: "Backing the short; not its notional",
    },
  ];
  return (
    <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="metric-card">
          <dt className="metric-label">{item.label}</dt>
          <dd className="metric-value">{item.value}</dd>
          <dd className="text-muted mt-1 text-xs">{item.hint}</dd>
        </div>
      ))}
    </dl>
  );
}
