const risks = [
  [
    "MON price",
    "Sixty percent of the vault is MON, so sdMON moves with the MON price today. The hedge leg that cancels this out is the next milestone.",
  ],
  [
    "Kuru liquidity",
    "Swaps go through Kuru's order book. If the fill would be worse than 0.5% off the oracle price, the deposit reverts rather than filling badly.",
  ],
  [
    "Oracle",
    "Vault value uses the Chainlink MON/USD feed. If it goes stale for a day, deposits and redemptions revert until it updates.",
  ],
  [
    "Smart contract",
    "DeltaMon contracts are new and unaudited. A deposit cap and a pause switch are in place while the code is reviewed.",
  ],
];

export function Risks() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
      <h2 className="text-2xl font-semibold sm:text-3xl">What can go wrong</h2>
      <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {risks.map(([title, body]) => (
          <div key={title}>
            <dt className="font-semibold">{title}</dt>
            <dd className="text-muted mt-1 text-sm leading-relaxed">{body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
