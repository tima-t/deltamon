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
    <section className="holdings-ledger" aria-labelledby="holdings-title">
      <div className="holdings-ledger-topline">
        <span>VAULT COMPOSITION / 01</span>
        <span>{stats.source === "demo" ? "ILLUSTRATIVE ASSET MIX" : "LIVE ASSET MIX"}</span>
      </div>
      <div className="holdings-ledger-intro">
        <p className="deposit-kicker">WHAT A SHARE REPRESENTS</p>
        <h2 id="holdings-title">
          Inside
          <br />
          <em>the vault.</em>
        </h2>
        <p>One share is a claim on the whole book. Here is the asset mix behind it.</p>
      </div>
      <div className="holdings-ledger-rows">
        {rows.map((row, index) => (
          <div key={row.name} className="holdings-ledger-row">
            <span className="holdings-ledger-index">0{index + 1}</span>
            <div className="holdings-ledger-row-main">
              <div className="holdings-ledger-row-head">
                <h3>{row.name}</h3>
                <strong>{formatUsd(row.value)}</strong>
              </div>
              <p>{row.detail}</p>
              <div className="holdings-ledger-bar">
                <span
                  style={{
                    width: `${Math.min(100, stats.tvlUsd ? (row.value / stats.tvlUsd) * 100 : 0)}%`,
                    background: row.color,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="holdings-ledger-note">
        <span aria-hidden="true">!</span>
        <p>
          <strong>Assets are not exposure.</strong> A smaller amount of manager capital may support
          a short equal to the MON held. Short size comes from the manager report; vault holdings
          come from onchain reads.
        </p>
      </div>
      <div className="holdings-ledger-footer">MEASURE THE LONG ↔ VERIFY THE SHORT</div>
    </section>
  );
}
