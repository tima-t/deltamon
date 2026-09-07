import { formatUsd } from "@/lib/format";
import type { VaultStats } from "@deltamon/shared";

export function HoldingsPanel({ stats }: { stats: VaultStats }) {
  const { allocation } = stats;
  const monAmount = Number(BigInt(allocation.mon.balance) / 10n ** 18n);
  const usdcAmount = Number(BigInt(allocation.usdc.balance)) / 10 ** stats.assetDecimals;
  const rows = [
    {
      name: "USDC",
      detail: `${usdcAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC, kept as is`,
      value: allocation.usdc.valueUsd,
      share: 10_000 - allocation.monShareBps,
    },
    {
      name: "MON",
      detail: `${monAmount.toLocaleString()} MON bought on Kuru at ${formatUsd(allocation.mon.priceUsd, { compact: false })}`,
      value: allocation.mon.valueUsd,
      share: allocation.monShareBps,
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold">What the vault holds</h2>
      <p className="text-muted mt-1 text-sm">
        Every sdMON is a claim on this book. Valued with the Chainlink MON/USD feed.
      </p>
      <table className="mt-4 w-full text-sm">
        <tbody className="divide-line divide-y">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="py-3 pr-3">
                <div className="font-medium">{r.name}</div>
                <div className="text-muted">{r.detail}</div>
              </td>
              <td className="py-3 text-right text-base font-medium tabular-nums">
                {formatUsd(r.value)}
                <div className="text-muted text-xs font-normal">{(r.share / 100).toFixed(1)}%</div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-ink border-t-2">
            <td className="py-3 pr-3 font-semibold">Total</td>
            <td className="py-3 text-right text-xl font-semibold tabular-nums">
              {formatUsd(stats.tvlUsd)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="text-muted mt-4 text-sm">
        The keeper rebalances back to {allocation.targetMonBps / 100}% MON when the split drifts
        more than {allocation.rebalanceThresholdBps / 100} points. Next on the roadmap: an
        equal-sized MON short on Perpl so sdMON stops moving with the MON price.
      </p>
    </div>
  );
}
