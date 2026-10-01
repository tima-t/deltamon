export function DepositRoute({
  source = "Monad",
  compact = false,
}: {
  source?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`deposit-route ${compact ? "deposit-route-compact" : ""}`}
      aria-label={`${source} USDC becomes sdMON vault shares on Monad`}
    >
      <div className="deposit-route-head">
        <span>THE ROUTE / STRATEGY 01</span>
        <span>USDC IN · SHARES OUT</span>
      </div>
      <div className="deposit-route-track">
        <div className="deposit-route-node deposit-route-source">
          <span className="deposit-route-node-index">01 / SOURCE</span>
          <strong>USDC</strong>
          <small>{source}</small>
        </div>
        <span className="deposit-route-connector" aria-hidden="true">
          <i />↗
        </span>
        <div className="deposit-route-node deposit-route-vault">
          <span className="deposit-route-node-index">02 / THE VAULT</span>
          <span className="deposit-route-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <strong>DeltaMon</strong>
        </div>
        <span className="deposit-route-connector" aria-hidden="true">
          <i />↗
        </span>
        <div className="deposit-route-node deposit-route-shares">
          <span className="deposit-route-node-index">03 / YOU OWN</span>
          <strong>sdMON</strong>
          <small>Vault shares</small>
        </div>
      </div>
      {!compact ? (
        <p className="deposit-route-foot">
          Your USDC enters the vault first. MON allocation and the offsetting short happen
          afterward. Your shares represent the whole vault, not a fixed amount of MON.
        </p>
      ) : null}
    </div>
  );
}
