const steps = [
  {
    title: "You deposit USDC",
    body: "The vault checks the deposit against its cap and minimum, then takes the USDC. Nothing leaves the vault contract.",
  },
  {
    title: "Sixty percent becomes MON",
    body: "In the same transaction the vault buys MON on Kuru's on-chain order book, within 0.5% of the Chainlink price, and holds it as WMON next to the remaining USDC.",
  },
  {
    title: "You receive sdMON",
    body: "Shares are minted for the value you actually added, so earlier depositors are never diluted by your swap. Redeem for USDC, or in kind for USDC and MON.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8">
      <h2 className="text-2xl font-semibold sm:text-3xl">How a deposit works</h2>
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
