import { formatUsd, formatPercent, bpsToPercent } from "@/lib/format";
import type { Leg } from "@deltamon/shared";

type Props = {
  long: Leg;
  short: Leg;
  netDeltaBps: number;
};

/**
 * The hero object: two legs on a beam, a needle at the net delta.
 * Fill widths are proportional to leg size; the needle offset is exaggerated
 * (1 % delta = 4 % travel) so small drifts stay visible.
 */
export function BalanceBeam({ long, short, netDeltaBps }: Props) {
  const total = long.valueUsd + short.valueUsd || 1;
  const longPct = (long.valueUsd / total) * 100;
  const shortPct = (short.valueUsd / total) * 100;
  const delta = bpsToPercent(netDeltaBps);
  const needle = Math.max(8, Math.min(92, 50 + delta * 4));

  return (
    <figure aria-label="Long and short legs of the vault" className="w-full">
      <div className="flex items-end justify-between gap-6 text-sm">
        <div>
          <div className="text-long font-medium">Long</div>
          <div className="text-muted">
            {long.asset} on {long.venue}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
            {formatUsd(long.valueUsd)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-short font-medium">Short</div>
          <div className="text-muted">
            {short.asset} on {short.venue}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
            {formatUsd(short.valueUsd)}
          </div>
        </div>
      </div>

      <div className="relative mt-5 h-4 w-full">
        <div className="bg-line absolute inset-0 rounded-full" />
        <div
          className="beam-fill bg-long absolute top-0 left-0 h-full rounded-l-full"
          style={{ width: `${longPct / 2}%` }}
        />
        <div
          className="beam-fill bg-short absolute top-0 right-0 h-full rounded-r-full"
          style={{ width: `${shortPct / 2}%` }}
        />
        <div
          className="beam-needle bg-ink absolute -top-2 h-8 w-1 -translate-x-1/2 rounded-full"
          style={{ left: `${needle}%` }}
          role="img"
          aria-label={`Net delta ${formatPercent(delta, 2)}`}
        />
      </div>

      <figcaption className="text-muted mt-3 text-center text-sm">
        Net delta{" "}
        <span className="text-ink font-medium tabular-nums">{formatPercent(delta, 2)}</span>
        {" · "}
        {Math.abs(delta) < 2 ? "hedged" : "rebalance due"}
      </figcaption>
    </figure>
  );
}
