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
      label: "Short backing capital",
      value: formatUsd(stats.hedge.managerCapitalUsd, { compact: true }),
      hint: "Outside the vault; not the short size",
    },
  ];
  return (
    <dl className="position-ledger">
      {items.map((item, index) => (
        <div key={item.label} className="position-ledger-item">
          <span className="position-ledger-index" aria-hidden="true">
            0{index + 1} / SUPPORTING READING
          </span>
          <dt className="metric-label">{item.label}</dt>
          <dd className="metric-value">{item.value}</dd>
          <dd className="position-ledger-hint">{item.hint}</dd>
        </div>
      ))}
    </dl>
  );
}
