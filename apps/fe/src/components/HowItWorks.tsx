import Image from "next/image";

const steps = [
  {
    title: "Enter with USDC",
    body: "Deposit on Monad, or choose a supported source chain when routing is enabled. You receive sdMON shares for your claim on the vault.",
  },
  {
    title: "Put MON to work",
    body: "The vault holds MON and can stake it. Its actual allocation changes as deposits, exits, prices and manager decisions change.",
  },
  {
    title: "Offset the exposure",
    body: "Capital sent to a perp manager supports a MON short. The manager reports its size; the engine compares that short with the MON held.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8">
      <p className="eyebrow">The mechanism / explained</p>
      <h2 className="mt-3 max-w-3xl text-3xl font-semibold sm:text-5xl">
        A vault you can read at a glance.
      </h2>
      <p className="text-muted mt-5 max-w-2xl text-base leading-relaxed">
        The amount used to back a short is not the same as the short&apos;s size. That distinction
        is the heart of the Balance Engine.
      </p>
      <ol className="mt-10 grid gap-6 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="panel p-6">
            <div className="eyebrow">
              0{i + 1} / {i === 0 ? "DEPOSIT" : i === 1 ? "LONG" : "SHORT"}
            </div>
            <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
            <p className="text-muted mt-3 text-sm leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>
      <details className="panel mt-6 p-6 sm:p-8">
        <summary className="cursor-pointer text-lg font-semibold">
          How can a 60/40 funding mix be delta neutral?
        </summary>
        <p className="text-muted mt-4 max-w-3xl text-sm leading-relaxed">
          For example, $60 of MON held can be offset by a $60 MON short backed by $40 of capital.
          The short uses 1.5× notional relative to that capital. The engine compares the $60 long
          with the $60 short, rather than comparing the $60 long with its $40 backing. Actual
          allocation and leverage can change; the dial displays reported values when they are
          available.
        </p>
        <Image
          src="/art/engine-poster.svg"
          alt="Illustrative balance dial showing $60 MON long, $60 MON short notional, and $40 collateral."
          width={840}
          height={740}
          className="mt-6 max-h-96 w-full rounded-xl object-contain"
        />
      </details>
    </section>
  );
}
