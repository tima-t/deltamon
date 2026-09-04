import { formatUsd, timeAgo } from "@/lib/format";
import type { VaultStats } from "@deltamon/shared";

export function StatsRow({ stats }: { stats: VaultStats }) {
  const items = [
    {
      label: "Net APY",
      value: `${stats.apy.net.toFixed(1)}%`,
      hint: stats.apy.source === "estimate" ? "estimated" : "realized, 30d",
    },
    {
      label: "Deposits",
      value: formatUsd(stats.tvlUsd, { compact: true }),
      hint: stats.depositCapUsd ? `cap ${formatUsd(stats.depositCapUsd, { compact: true })}` : "",
    },
    {
      label: "Hedge ratio",
      value: `${(stats.hedgeRatioBps / 100).toFixed(1)}%`,
      hint: "short ÷ long",
    },
    { label: "Last rebalance", value: timeAgo(stats.lastRebalanceAt), hint: "keeper" },
  ];

  return (
    <dl className="divide-line grid grid-cols-2 divide-y sm:grid-cols-4 sm:divide-x sm:divide-y-0">
      {items.map((it) => (
        <div key={it.label} className="px-4 py-4 first:pl-0 sm:py-2">
          <dt className="text-muted text-sm">{it.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{it.value}</dd>
          {it.hint ? <dd className="text-muted text-xs">{it.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
