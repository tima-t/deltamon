import { LONG_ARC, SHORT_ARC } from "@/lib/exposurePlateGeometry";

const steps = [
  {
    title: "Enter with USDC",
    body: "Deposit on Monad, or choose a supported source chain when routing is enabled. You receive sdMON shares for your claim on the vault.",
  },
  {
    title: "Stake MON",
    body: "The vault allocates part of its assets to MON and stakes it. The amount can change as deposits, exits, and prices change.",
  },
  {
    title: "Offset the exposure",
    body: "An automated process opens an offsetting MON short. Check its latest reported size and update time against the MON held by the vault.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="counter-how mx-auto w-full max-w-7xl px-5 py-16 sm:px-8">
      <p className="counter-section-index">03 / HOW THIS ONE WORKS</p>
      <h2>
        The MON strategy.
        <br />
        <em>Step by step.</em>
      </h2>
      <p className="counter-how-intro">
        The vault holds MON and aims to reduce its price exposure with a short. The position above
        shows the MON held and the reported short separately. It estimates their difference only
        when the short report is current.
      </p>
      <ol className="counter-story-grid mt-10 grid gap-6 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="panel counter-story-card p-6">
            <div className="counter-story-number">
              0{i + 1}
              <span aria-hidden="true">↗</span>
            </div>
            <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
            <p className="text-muted mt-3 text-sm leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>
      <details className="panel counter-example mt-6 p-6 sm:p-8">
        <summary className="cursor-pointer text-lg font-semibold">
          Why is the backing capital smaller than the short?
        </summary>
        <p className="text-muted mt-4 max-w-3xl text-sm leading-relaxed">
          For example, $60 of MON held can be offset by a $60 MON short backed by $40 of capital.
          The short is larger than the capital backing it. The plate compares the two $60 positions;
          the $40 is shown separately. Actual amounts can change, and a live comparison needs a
          current short report.
        </p>
        <figure
          className="position-plate faq-exposure-plate"
          aria-label="Illustrative exposure plate: $60 of MON held, a $60 MON short, zero percent net MON exposure, and $40 of manager capital backing the short."
        >
          <div className="position-plate-topline">
            <span>DELTAMON / FIELD INSTRUMENT 01</span>
            <span>WORKED EXAMPLE</span>
          </div>
          <div className="position-plate-header">
            <div>
              <p className="position-plate-kicker">60 / 40 EXPLAINED</p>
              <h3>EQUAL EXPOSURE. DIFFERENT CAPITAL.</h3>
            </div>
            <span className="position-plate-status" data-tone="muted">
              <i aria-hidden="true" /> ILLUSTRATIVE ONLY
            </span>
          </div>
          <div className="position-plate-main">
            <div className="position-reading position-reading-long">
              <span className="position-reading-index">01 / EXAMPLE HOLDING</span>
              <span className="position-reading-name">MON held</span>
              <strong>$60</strong>
              <p>Vault side</p>
            </div>
            <div className="position-plate-graphic">
              <svg viewBox="0 0 520 340" aria-hidden="true">
                <path className="position-arc-track" d={LONG_ARC} />
                <path className="position-arc-track" d={SHORT_ARC} />
                <path className="position-arc-long" d={LONG_ARC} />
                <path className="position-arc-short" d={SHORT_ARC} />
                <path className="position-plate-axis" d="M260 73 V 286 M236 286 H284" />
                <circle className="position-plate-pivot" cx="260" cy="74" r="10" />
                <circle className="position-plate-pivot-core" cx="260" cy="74" r="3" />
                <path className="position-plate-end-mark" d="M54 275 V289 M466 275 V289" />
              </svg>
              <div className="position-net-reading">
                <span>03 / NET MON EXPOSURE</span>
                <strong>0.0%</strong>
                <small>ILLUSTRATIVE READING</small>
              </div>
              <div className="position-graphic-scale" aria-hidden="true">
                <span>VAULT SIDE</span>
                <span>SAME USD SCALE</span>
                <span>SHORT REPORT</span>
              </div>
            </div>
            <div className="position-reading position-reading-short">
              <span className="position-reading-index">02 / EXAMPLE SHORT</span>
              <span className="position-reading-name">MON short size</span>
              <strong>$60</strong>
              <p>Reported short</p>
            </div>
          </div>
          <figcaption className="position-plate-foot">
            <div className="position-plate-provenance">
              <span className="position-provenance-mark" aria-hidden="true">
                ≠
              </span>
              <div>
                <strong>CAPITAL IS NOT EXPOSURE.</strong>
                <p>The hedge comparison is $60 against $60, not $60 against $40.</p>
              </div>
            </div>
            <div className="position-plate-book">
              <span>PERP BOOK / BACKING CAPITAL</span>
              <strong>$40</strong>
              <p>Supports the $60 short at 1.5× notional.</p>
            </div>
          </figcaption>
        </figure>
      </details>
    </section>
  );
}
