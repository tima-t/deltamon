"use client";

import { useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import styles from "@/components/deposit-press/concepts.module.css";
import StrategyIllustration from "@/components/deposit-press/StrategyIllustration";
import StepTransition from "@/components/deposit-press/StepTransition";

const Scene = dynamic(() => import("@/components/deposit-press/ConceptScene"), {
  ssr: false,
  loading: () => <div className={styles.loading}>Setting the scene…</div>,
});
const steps = ["Access", "Source", "Amount", "Review", "Track"];
const sources = [
  { name: "Monad", balance: 2500, symbol: "◈" },
  { name: "Base", balance: 1250, symbol: "●" },
  { name: "Polygon", balance: 750, symbol: "⬡" },
];
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function DepositConcepts() {
  const [concept, setConcept] = useState<"press" | "sculpture">("press");
  const [dark, setDark] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [printRun, setPrintRun] = useState(0);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const prefersReducedMotion = useReducedMotion();
  const reduce = reducedMotion || Boolean(prefersReducedMotion) || paused;
  const goTo = (next: number) => {
    setDirection(next >= step ? 1 : -1);
    setStep(next);
  };
  const contentMotion = {
    enter: (d: number) => ({ opacity: reduce ? 1 : 0, x: reduce ? 0 : d * 12 }),
    center: { opacity: 1, x: 0 },
  };
  const [source, setSource] = useState(sources[0]!);
  const [amount, setAmount] = useState("250");
  const [tracking, setTracking] = useState(0);
  const [error, setError] = useState(false);
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= source.balance;
  const complete = step === 4 && tracking === 4;
  const reset = () => {
    goTo(0);
    setTracking(0);
    setError(false);
  };
  const labels = [
    "Wallet authorization",
    `Source transfer · ${source.name}`,
    source.name === "Monad" ? "USDC ready on Monad" : "Route to Monad",
    "Vault receipt & shares",
  ];
  return (
    <LayoutGroup id="deposit-concepts">
      <main
        className={`${styles.root} ${dark ? styles.dark : ""}`}
        data-motion={paused ? "paused" : "running"}
        data-reduced-motion={reducedMotion}
      >
        <header className={styles.toolbar}>
          <Link href="/#deposit" className={styles.back}>
            ← Live version
          </Link>
          <div className={styles.switcher} aria-label="Choose design concept">
            <button aria-pressed={concept === "press"} onClick={() => setConcept("press")}>
              <span>A</span> Deposit Press
            </button>
            <button aria-pressed={concept === "sculpture"} onClick={() => setConcept("sculpture")}>
              <span>B</span> Counterweight
            </button>
          </div>
          <span className={styles.studyBadge}>DESIGN STUDY / 02</span>
        </header>
        <div className={styles.previewTools}>
          <p>
            Interactive simulation <span>· No wallet or funds · Fictional amounts</span>
          </p>
          <div>
            <button aria-pressed={mobile} onClick={() => setMobile(!mobile)}>
              Phone view
            </button>
            <button aria-pressed={dark} onClick={() => setDark(!dark)}>
              {dark ? "Light" : "Dark"}
            </button>
            <button aria-pressed={reducedMotion} onClick={() => setReducedMotion(!reducedMotion)}>
              Reduced motion
            </button>
            <button aria-pressed={paused} onClick={() => setPaused(!paused)}>
              {paused ? "Resume motion" : "Pause motion"}
            </button>
          </div>
        </div>
        <div className={`${styles.preview} ${mobile ? styles.phone : ""}`}>
          <div className={styles.masthead}>
            <strong>
              delta<span>mon</span>
              <i>®</i>
            </strong>
            <span>
              STRATEGY 01 <b>MONAD / MON VAULT</b>
            </span>
            <span className={styles.edition}>THE COUNTERWEIGHT SERIES</span>
          </div>
          <motion.section
            layout
            transition={{ duration: reduce ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }}
            className={`${styles.hero} ${concept === "press" ? styles.pressHero : styles.sculptureHero} ${step === 4 ? styles.trackingHero : ""}`}
          >
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>
                02 / YOUR MOVE <span>↘</span>
              </p>
              <h1>
                {step === 4 ? (
                  <>
                    Your move. <em>{complete ? "Recorded." : "In motion."}</em>
                  </>
                ) : (
                  <>
                    Ready when
                    <br />
                    <em>you are.</em>
                  </>
                )}
              </h1>
              <p className={styles.intro}>
                Your USDC. Your share of the vault.
                <br />A considered move, from start to receipt.
              </p>
              <div className={styles.signature}>
                <span>{concept === "press" ? "01—A" : "01—B"}</span>
                <p>
                  {concept === "press" ? "Make your mark." : "A little counterweight."}
                  <small>{concept === "press" ? "THE DEPOSIT PRESS" : "THE BALANCE STUDY"}</small>
                </p>
              </div>
            </div>
            <div className={styles.art}>
              <div className={styles.artOrbit} aria-hidden="true" />
              <div className={styles.scene}>
                {step !== 4 && (
                  <Scene
                    concept={concept}
                    dark={dark}
                    paused={paused}
                    stage={step}
                    reducedMotion={reducedMotion}
                  />
                )}
              </div>
              <span className={styles.artIndex}>
                {concept === "press" ? "FIG. A / ENTRY APPARATUS" : "FIG. B / COUNTERWEIGHT"}
              </span>
              <span className={styles.artNote}>
                ILLUSTRATIVE OBJECT
                <br />
                {concept === "press" ? "PAPER. INK. INTENTION." : "FORM, NOT LIVE EXPOSURE."}
              </span>
            </div>
          </motion.section>
          <motion.section
            layout="position"
            transition={{ duration: reduce ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }}
            className={`${styles.ticket} ${concept === "press" ? styles.pressTicket : styles.sculptureTicket}`}
            aria-label="Simulated deposit"
          >
            <div className={styles.ticketHeader}>
              <span>DEPOSIT / STRATEGY 01</span>
              <span>
                {source.name.toUpperCase()} <b>USDC → sdMON</b> MONAD
              </span>
              <span>DEMO Nº 0001</span>
            </div>
            <nav className={styles.progress} aria-label="Preview deposit steps">
              <motion.i
                aria-hidden="true"
                className={styles.progressIndicator}
                initial={false}
                animate={{ x: `${step * 100}%` }}
                transition={{ type: "spring", duration: reduce ? 0 : 0.42, bounce: 0 }}
              >
                <i />
              </motion.i>
              {steps.map((label, index) => (
                <button
                  key={label}
                  aria-current={step === index ? "step" : undefined}
                  onClick={() => {
                    if (index < 3 || valid) {
                      goTo(index);
                      setError(false);
                    }
                  }}
                >
                  <span>{index < step ? "✓" : `0${index + 1}`}</span>
                  {label}
                </button>
              ))}
            </nav>
            <StepTransition step={step} direction={direction} reduce={reduce}>
              <div
                className={`${styles.ticketBody} ${step === 4 ? styles.trackingBody : ""}`}
                data-working={step === 4 && !complete && !error}
              >
                <motion.div
                  className={styles.stepIntro}
                  variants={contentMotion}
                  custom={direction}
                  transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.04 }}
                >
                  <p className={styles.kicker}>
                    {complete
                      ? "YOUR ENTRY, RECORDED"
                      : `0${step + 1} / ${steps[step]!.toUpperCase()}`}
                  </p>
                  <h2 data-step-heading tabIndex={-1}>
                    {
                      [
                        "Every move starts somewhere.",
                        "Where is your USDC?",
                        "What’s your move?",
                        "Make it yours.",
                        complete ? "A receipt worth keeping." : "Follow your move.",
                      ][step]
                    }
                  </h2>
                  <p>
                    {
                      [
                        "Choose your wallet, then your starting point. You’ll review the full route before signing.",
                        "One destination. Your choice of starting point. Select a source to continue.",
                        "Start with USDC. Receive a share of the whole MON vault.",
                        "Your amount, your destination, your estimated shares. All in one place.",
                        complete
                          ? "This is how a verified deposit could feel. This receipt is a simulation."
                          : "Each real-world step needs its own confirmation. Explore those moments here.",
                      ][step]
                    }
                  </p>
                  {step > 0 && !complete && (
                    <button
                      className={styles.textButton}
                      onClick={() => {
                        goTo(step - 1);
                        setError(false);
                      }}
                    >
                      ← {step === 3 ? "Edit amount" : "Back"}
                    </button>
                  )}
                  {step === 4 && (
                    <div className={styles.trackingPress}>
                      <div className={styles.trackingScene}>
                        <Scene
                          concept={concept}
                          dark={dark}
                          paused={paused || error}
                          stage={step}
                          working={!complete && !error}
                          complete={complete}
                          printRun={printRun}
                          confirmedSteps={tracking}
                          sourceName={source.name}
                          amount={money(value)}
                          reducedMotion={reducedMotion}
                        />
                      </div>
                      <div className={styles.pressCaption}>
                        <span className={styles.pressSignal} />
                        <span>
                          {error
                            ? "PRESS ON HOLD"
                            : complete
                              ? "FOUR CONFIRMATIONS / ONE PRINTED RECEIPT"
                              : paused || reducedMotion
                                ? `PAPER HELD / ${tracking} OF 4 RECORDED`
                                : `${tracking} OF 4 RECORDED / AWAITING NEXT CONFIRMATION`}
                        </span>
                      </div>
                      <p className={styles.fine}>Illustrative motion · No elapsed-time estimate</p>
                      {complete && concept === "press" && (
                        <button
                          className={styles.textButton}
                          onClick={() => setPrintRun((value) => value + 1)}
                        >
                          Replay receipt printing ↻
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
                <motion.div
                  className={styles.actionArea}
                  variants={contentMotion}
                  custom={direction}
                  transition={{ duration: reduce ? 0 : 0.32, delay: reduce ? 0 : 0.09 }}
                >
                  <StepTransition step={complete ? 1 : 0} direction={1} reduce={reduce}>
                    {step === 0 && (
                      <>
                        <div className={styles.accessMark} aria-hidden="true">
                          <span>↗</span>
                          <i>YOUR NEXT CHAPTER</i>
                        </div>
                        <button className={styles.primary} onClick={() => goTo(1)}>
                          Explore the deposit <span>↗</span>
                        </button>
                        <p className={styles.fine}>
                          Simulate wallet access · No connection required
                        </p>
                      </>
                    )}
                    {step === 1 && (
                      <div className={styles.sources}>
                        {sources.map((s) => (
                          <button
                            key={s.name}
                            onClick={() => {
                              setSource(s);
                              if (value > s.balance) setAmount(String(s.balance));
                              goTo(2);
                            }}
                          >
                            <span className={styles.chainSymbol}>{s.symbol}</span>
                            <strong>
                              {s.name}
                              <small>{money(s.balance)} USDC</small>
                            </strong>
                            <span>↗</span>
                          </button>
                        ))}
                        <p className={styles.fine}>Illustrative balances, not wallet readings</p>
                      </div>
                    )}
                    {step === 2 && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (valid) goTo(3);
                        }}
                      >
                        <div className={styles.amountTop}>
                          <label htmlFor="study-amount">YOU SEND</label>
                          <button type="button" onClick={() => setAmount(String(source.balance))}>
                            Use {money(source.balance)} USDC
                          </button>
                        </div>
                        <div className={styles.amountField}>
                          <input
                            id="study-amount"
                            inputMode="decimal"
                            autoComplete="off"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            aria-describedby="study-amount-help"
                          />
                          <span>
                            USDC<small>ON {source.name.toUpperCase()}</small>
                          </span>
                        </div>
                        <p className={styles.fine} id="study-amount-help">
                          {!valid
                            ? "Enter an amount above zero, within the demo balance."
                            : "Illustrative quote · 1 USDC = 1 sdMON"}
                        </p>
                        <button className={styles.primary} disabled={!valid}>
                          Review deposit <span>↗</span>
                        </button>
                      </form>
                    )}
                    {step === 3 && (
                      <>
                        <dl className={styles.review}>
                          <div>
                            <dt>You send</dt>
                            <dd>
                              {money(value)} <small>USDC / {source.name}</small>
                            </dd>
                          </div>
                          <div>
                            <dt>Estimated shares</dt>
                            <dd className={styles.violet}>
                              {money(value)} <small>sdMON</small>
                            </dd>
                          </div>
                          <div>
                            <dt>Destination</dt>
                            <dd>Monad vault</dd>
                          </div>
                          <div>
                            <dt>Fees & share price</dt>
                            <dd>Illustrative · not a live quote</dd>
                          </div>
                        </dl>
                        <p className={styles.disclosure}>
                          sdMON represents your share of the pooled vault. Allocation to MON and the
                          short happens separately. A live review would show current fees and route
                          costs.
                        </p>
                        <button
                          className={styles.primary}
                          onClick={() => {
                            goTo(4);
                            setTracking(0);
                            setError(false);
                          }}
                        >
                          Preview authorization <span>↗</span>
                        </button>
                      </>
                    )}
                    {step === 4 && !complete && (
                      <>
                        <ol className={styles.tracking}>
                          {labels.map((label, index) => (
                            <li
                              key={label}
                              data-state={
                                index < tracking
                                  ? "done"
                                  : index === tracking
                                    ? "active"
                                    : "waiting"
                              }
                            >
                              <span>{index < tracking ? "✓" : `0${index + 1}`}</span>
                              <strong>{label}</strong>
                              <small>
                                {index < tracking
                                  ? "SIMULATED"
                                  : index === tracking
                                    ? error
                                      ? "FAILED"
                                      : "AWAITING"
                                    : "UP NEXT"}
                              </small>
                            </li>
                          ))}
                        </ol>
                        <p className={styles.fine} role={error ? "alert" : "status"}>
                          {error
                            ? "Simulated failure. Your source and amount are saved. Retry this step."
                            : "Manual simulation · No transaction is submitted"}
                        </p>
                        <button
                          className={styles.primary}
                          onClick={() => {
                            if (error) setError(false);
                            else {
                              setTracking(tracking + 1);
                            }
                          }}
                        >
                          {error
                            ? "Retry simulated step"
                            : tracking === 3
                              ? "Simulate share confirmation"
                              : "Simulate next confirmation"}
                          <span>↗</span>
                        </button>
                        {!error && (
                          <button className={styles.textButton} onClick={() => setError(true)}>
                            Preview a failure
                          </button>
                        )}
                      </>
                    )}
                    {complete && (
                      <div className={styles.receipt} role="status">
                        <div className={styles.receiptStamp}>
                          ✓
                          <span>
                            DEMO
                            <br />
                            RECEIPT
                          </span>
                        </div>
                        <p className={styles.kicker}>ILLUSTRATIVE SHARES RECEIVED</p>
                        <strong>
                          {money(value)} <small>sdMON</small>
                        </strong>
                        <div className={styles.receiptDetail}>
                          <span>
                            {money(value)} USDC / {source.name}
                          </span>
                          <span>STRATEGY 01</span>
                        </div>
                        <div className={styles.barcode} aria-hidden="true" />
                        <p className={styles.fine}>No funds moved. No shares were minted.</p>
                        <button className={styles.primary} onClick={reset}>
                          Try the journey again <span>↻</span>
                        </button>
                      </div>
                    )}
                  </StepTransition>
                </motion.div>
              </div>
              {step === 4 && (
                <StrategyIllustration
                  confirmed={complete}
                  paused={paused || error}
                  reducedMotion={reducedMotion}
                />
              )}
            </StepTransition>
            <footer className={styles.ticketFooter}>
              <span>USDC IN. A SHARE OF THE VAULT OUT.</span>
              <span>{complete ? "SIMULATION COMPLETE" : "ESTIMATES ARE NOT CONFIRMATIONS"}</span>
            </footer>
          </motion.section>
          <motion.div
            layout="position"
            transition={{ duration: reduce ? 0 : 0.38 }}
            className={styles.returnRoute}
          >
            <span>03 / THE RETURN ROUTE</span>
            <p>Your exit stays in view.</p>
            <span>
              sdMON <b>↗</b> USDC
            </span>
          </motion.div>
        </div>
        <footer className={styles.studyFooter}>
          <div>
            <span>{concept === "press" ? "DIRECTION A" : "DIRECTION B"}</span>
            <h3>
              {concept === "press"
                ? "A little ceremony. A lasting receipt."
                : "An object you remember. A flow you understand."}
            </h3>
            <p>
              {concept === "press"
                ? "The mechanical press advances with your demo journey. The paper interface becomes the final receipt."
                : "A ceramic and brass sculpture gives the chapter its identity. It settles as soon as you start the deposit."}
            </p>
          </div>
          <div>
            <button onClick={reset}>Restart preview ↻</button>
            <Link href="/deposit-lab">Original deposit lab ↗</Link>
            <p>
              Switch concepts at any step.
              <br />
              Your demo amount and source stay with you.
            </p>
          </div>
        </footer>
      </main>
    </LayoutGroup>
  );
}
