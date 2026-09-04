import type { ApyBreakdown } from "@deltamon/shared";

export function YieldBreakdown({ apy }: { apy: ApyBreakdown }) {
  const rows = [
    { name: "Staking rewards", detail: "aprMON accrues MON staking yield", value: apy.staking },
    {
      name: "Funding payments",
      detail: "shorts receive funding when the perp trades rich",
      value: apy.funding,
    },
    { name: "Lending", detail: "idle collateral, when a market lists it", value: apy.lending },
    { name: "Costs", detail: "swap fees, gas, performance fee", value: apy.costs },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold">Where the yield comes from</h2>
      <p className="text-muted mt-1 text-sm">
        Annualized,{" "}
        {apy.source === "estimate" ? "estimated from current rates" : "realized over 30 days"}.
      </p>
      <table className="mt-4 w-full text-sm">
        <tbody className="divide-line divide-y">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="py-3 pr-3">
                <div className="font-medium">{r.name}</div>
                <div className="text-muted">{r.detail}</div>
              </td>
              <td
                className={`py-3 text-right text-base font-medium tabular-nums ${r.value < 0 ? "text-short" : ""}`}
              >
                {r.value > 0 ? "+" : ""}
                {r.value.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-ink border-t-2">
            <td className="py-3 pr-3 font-semibold">Net, paid in USDC</td>
            <td className="py-3 text-right text-xl font-semibold tabular-nums">
              {apy.net.toFixed(1)}%
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
