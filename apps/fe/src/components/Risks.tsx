const risks = [
  [
    "Funding turns negative",
    "Shorts pay longs when the perp trades below spot. The strategy tolerates short stretches; the keeper reduces the hedge if it persists.",
  ],
  [
    "Liquid staking token depeg",
    "aprMON can trade below its MON value. The oracle prices it directly, so the vault's reported value reflects it.",
  ],
  [
    "Venue risk",
    "Kuru, aPriori and Perpl are third-party contracts. The guardian can pull everything back to the vault at once.",
  ],
  [
    "Smart contract risk",
    "DeltaMon contracts are new and unaudited. Deposit caps are in place while the code is reviewed.",
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
