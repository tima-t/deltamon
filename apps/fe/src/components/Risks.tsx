const risks = [
  [
    "Hedge and MON price",
    "The vault targets low net MON exposure, but the short can lag the long as prices and positions move. The engine shows measured drift only when the manager's report is fresh.",
  ],
  [
    "Manager custody and reporting",
    "Capital sent to a perp manager leaves the vault's direct control. The manager also reports short size offchain. The allocation ceiling and timelocks limit this trust boundary; they do not remove it.",
  ],
  [
    "Liquidity and exits",
    "Exits are paid out of the vault's idle USDC and nothing else. When the book is deployed and idle cash runs short, you can only redeem what is available and wait for the admin to unwind the rest. Nothing in the contract forces that unwind.",
  ],
  [
    "Oracles and contracts",
    "Vault valuation depends on its price oracle. The contracts are new and unaudited; deposit caps and pause controls are in place while the system is reviewed.",
  ],
];

export function Risks() {
  return (
    <section id="risks" className="mx-auto w-full max-w-7xl px-5 pb-20 sm:px-8">
      <p className="eyebrow">Read the fine print / 05</p>
      <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">The risk stays visible.</h2>
      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        {risks.map(([title, body]) => (
          <div key={title} className="panel p-6">
            <dt className="text-lg font-semibold">{title}</dt>
            <dd className="text-muted mt-2 text-sm leading-relaxed">{body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
