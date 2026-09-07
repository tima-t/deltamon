import { formatPrice, formatUsd } from "@/lib/format";
import type { Allocation } from "@deltamon/shared";

/**
 * The hero object: what the vault holds, as one bar. USDC on the left, MON on the right,
 * a marker at the 60 % target. The fill animates once on load.
 */
export function AllocationBar({ allocation }: { allocation: Allocation }) {
  const { usdc, mon, monShareBps, targetMonBps, driftBps, rebalanceThresholdBps } = allocation;
  const monPct = monShareBps / 100;
  const usdcPct = 100 - monPct;
  const targetPct = targetMonBps / 100;
  const drifted = Math.abs(driftBps) > rebalanceThresholdBps;
  const monAmount = Number(BigInt(mon.balance) / 10n ** 18n);

  return (
    <figure aria-label="Vault holdings" className="w-full">
      <div className="flex items-end justify-between gap-6 text-sm">
        <div>
          <div className="text-muted">USDC held</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
            {formatUsd(usdc.valueUsd)}
          </div>
          <div className="text-muted tabular-nums">{usdcPct.toFixed(1)}% of the vault</div>
        </div>
        <div className="text-right">
          <div className="text-monad font-medium">MON held</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
            {formatUsd(mon.valueUsd)}
          </div>
          <div className="text-muted tabular-nums">
            {monAmount.toLocaleString()} MON · {monPct.toFixed(1)}% of the vault
          </div>
        </div>
      </div>

      <div className="relative mt-5 h-4 w-full">
        <div className="bg-line absolute inset-0 rounded-full" />
        <div
          className="beam-fill bg-monad absolute top-0 right-0 h-full rounded-r-full"
          style={{ width: `${monPct}%` }}
        />
        <div
          className="beam-needle bg-ink absolute -top-2 h-8 w-0.5 -translate-x-1/2"
          style={{ left: `${100 - targetPct}%` }}
          role="img"
          aria-label={`Target ${targetPct}% MON`}
        />
      </div>

      <figcaption className="text-muted mt-3 flex justify-between text-sm">
        <span>
          Target {targetPct}% MON ·{" "}
          <span className={drifted ? "text-short" : "text-ink"}>
            {drifted ? "rebalance due" : "on target"}
          </span>
        </span>
        <span className="tabular-nums">MON {formatPrice(mon.priceUsd)}</span>
      </figcaption>
    </figure>
  );
}
