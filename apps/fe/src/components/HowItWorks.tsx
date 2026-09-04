const steps = [
  {
    title: "You deposit USDC",
    body: "The vault mints dmUSDC shares. Nothing else moves until the keeper batches deposits into the strategy.",
  },
  {
    title: "The strategy opens two legs",
    body: "Half buys MON on Kuru and stakes it with aPriori. Half backs an equal-sized MON short on Perpl.",
  },
  {
    title: "The keeper keeps them equal",
    body: "When MON moves, one leg gains what the other loses. If net delta drifts past 2%, rebalance() resets it. The keeper can only rebalance; it can never withdraw.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
      <h2 className="text-2xl font-semibold sm:text-3xl">How it stays neutral</h2>
      <ol className="mt-8 grid gap-8 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="border-line border-t pt-4">
            <div className="text-monad text-sm font-medium tabular-nums">Step {i + 1}</div>
            <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
            <p className="text-muted mt-2 text-sm leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
