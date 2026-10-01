const risks = [
  [
    "MON exposure can change",
    "The short can lag the MON held as prices and positions move. DeltaMon shows an exposure estimate only when the latest short report is current.",
  ],
  [
    "Funds backing the short",
    "Funds allocated to the short are held outside the vault's direct control. The separate account reports the short size and value; those reports can be delayed or inaccurate.",
  ],
  [
    "Liquidity and exits",
    "Redemptions use the vault's available USDC. If there is not enough, you can redeem the available portion and wait for the admin to return more USDC to the vault. There is no automatic deadline for that action.",
  ],
  [
    "Oracles and contracts",
    "Vault valuation depends on its price oracle. The contracts are new and unaudited; deposit caps and pause controls are in place while the system is reviewed.",
  ],
];

export function Risks() {
  return (
    <section id="risks" className="counter-risks mx-auto w-full max-w-7xl px-5 pb-20 sm:px-8">
      <p className="counter-section-index">04 / BEFORE YOU DEPOSIT</p>
      <h2>
        Know the risks
        <br />
        <em>before you act.</em>
      </h2>
      <p className="counter-risks-intro">
        The hedge target, report timing, and available exit liquidity can all change. These are the
        main limits to understand before depositing.
      </p>
      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        {risks.map(([title, body]) => (
          <div key={title} className="panel counter-risk-card p-6">
            <dt className="text-lg font-semibold">{title}</dt>
            <dd className="text-muted mt-2 text-sm leading-relaxed">{body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
