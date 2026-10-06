"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { showReturnRouteAfterDeposit } from "@/lib/depositConfirmation";
import { DepositJourney } from "./DepositJourney";
import {
  DepositSourceConstellation,
  DepositSelectedSource,
  type DepositSourceStar,
} from "./DepositSourceConstellation";
import { DepositStepIndicator, type DepositStep } from "./DepositStepIndicator";

const mockSources: DepositSourceStar[] = [
  { id: "monad", name: "Monad", balance: "2240000", decimals: 6 },
  { id: "base", name: "Base", balance: "2420000", decimals: 6 },
  { id: "polygon", name: "Polygon", balance: "310000", decimals: 6 },
];

type LabStage =
  | "connect"
  | "source"
  | "amount"
  | "review"
  | "approval"
  | "deposit"
  | "pending"
  | "source-sent"
  | "routing"
  | "arrived"
  | "vault"
  | "mint-check"
  | "route-failed"
  | "expired"
  | "success"
  | "error";

const routePhases = [
  {
    stage: "source-sent",
    label: "01 / SOURCE SENT",
    status: "DEPOSIT_PENDING",
    sourceTxSent: true,
    mintConfirmed: false,
  },
  {
    stage: "routing",
    label: "02 / ROUTING",
    status: "DEPOSIT_PROCESSING",
    sourceTxSent: true,
    mintConfirmed: false,
  },
  {
    stage: "arrived",
    label: "03 / ARRIVED",
    status: "OPERATION_PENDING",
    sourceTxSent: true,
    mintConfirmed: false,
  },
  {
    stage: "vault",
    label: "04 / VAULT CALL",
    status: "OPERATION_PROCESSING",
    sourceTxSent: true,
    mintConfirmed: false,
  },
  {
    stage: "mint-check",
    label: "05 / MINT CHECK",
    status: "SUCCESS",
    sourceTxSent: true,
    mintConfirmed: false,
  },
  {
    stage: "success",
    label: "06 / CONFIRMED",
    status: "SUCCESS",
    sourceTxSent: true,
    mintConfirmed: true,
  },
  {
    stage: "route-failed",
    label: "! / VAULT FAILED",
    status: "OPERATION_FAILED",
    sourceTxSent: true,
    mintConfirmed: false,
  },
  {
    stage: "expired",
    label: "! / EXPIRED",
    status: "EXPIRED",
    sourceTxSent: false,
    mintConfirmed: false,
  },
] as const;

export function DepositFlowLab({
  initialStage = "connect",
}: {
  initialStage?: "connect" | "source";
}) {
  const [stage, setStage] = useState<LabStage>(initialStage);
  const [source, setSource] = useState("Monad");
  const [amount, setAmount] = useState("");
  const [errorAt, setErrorAt] = useState<"none" | "approval" | "deposit" | "vault">("none");
  const [routeStudy, setRouteStudy] = useState(false);
  const [journeyAppearance, setJourneyAppearance] = useState("light");
  const [reduceJourneyMotion, setReduceJourneyMotion] = useState(false);
  const [previewLiveAutoplay, setPreviewLiveAutoplay] = useState(false);
  const sourceStar = mockSources.find((item) => item.name === source) ?? mockSources[0]!;
  const sourceBalance = Number(sourceStar.balance) / 10 ** sourceStar.decimals;
  const valid = Number(amount) > 0 && Number(amount) <= sourceBalance;
  const crossChain = source !== "Monad";
  const routePhase = crossChain ? routePhases.find((phase) => phase.stage === stage) : undefined;
  const currentStep: DepositStep =
    stage === "connect" || stage === "source" || stage === "amount" || stage === "review"
      ? stage
      : "track";
  useEffect(() => {
    if (stage === "success" && !routeStudy && (!previewLiveAutoplay || !crossChain))
      showReturnRouteAfterDeposit();
  }, [stage, routeStudy, previewLiveAutoplay, crossChain]);
  function reset() {
    setStage("connect");
    setSource("Monad");
    setAmount("");
    setErrorAt("none");
    setRouteStudy(false);
  }
  function nextAfterReview() {
    setStage("approval");
  }
  function finishApproval() {
    setStage(errorAt === "approval" ? "error" : "deposit");
  }
  function finishDeposit() {
    setStage(errorAt === "deposit" ? "error" : crossChain ? "source-sent" : "pending");
  }
  function jumpToRoute(stage: (typeof routePhases)[number]["stage"]) {
    setRouteStudy(true);
    setSource("Base");
    setAmount("1.1");
    setStage(stage);
  }
  function advanceRoute() {
    const next: Partial<Record<LabStage, LabStage>> = {
      "source-sent": "routing",
      routing: "arrived",
      arrived: "vault",
      vault: errorAt === "vault" ? "route-failed" : "mint-check",
      "mint-check": "success",
    };
    setStage(next[stage] ?? stage);
  }
  return (
    <main className="deposit-lab-page">
      <div className="deposit-lab-header">
        <Link href="/">← DeltaMon</Link>
        <span>DEVELOPMENT PREVIEW · SIMULATED FLOW · NO WALLET OR FUNDS</span>
      </div>
      <div className="deposit-lab-grid">
        <div className="deposit-lab-workbench">
          <p className="counter-section-index">STRATEGY 01 / EXPERIENCE LAB</p>
          <h1>Deposit flow lab.</h1>
          <p>
            Walk through the full deposit journey. Every balance, quote, transaction, and outcome
            here is fictional.
          </p>
          <details className="deposit-lab-tools">
            <summary>Simulation controls</summary>
            <div className="deposit-lab-controls">
              <label>
                Simulate an error at{" "}
                <select
                  value={errorAt}
                  onChange={(e) => setErrorAt(e.target.value as typeof errorAt)}
                >
                  <option value="none">No error</option>
                  <option value="approval">Wallet approval</option>
                  <option value="deposit">Deposit transaction</option>
                  <option value="vault">Cross-chain vault call</option>
                </select>
              </label>
              <button type="button" onClick={reset}>
                Start again
              </button>
              <button type="button" onClick={() => setStage("source")}>
                Inspect source atlas
              </button>
              <Link className="deposit-lab-source-link" href="/deposit-lab/source">
                Direct source preview ↗
              </Link>
            </div>
            <section className="deposit-lab-route-controls" aria-labelledby="route-study-heading">
              <h2 id="route-study-heading" className="deposit-kicker">
                CROSS-CHAIN MOTION STUDY / MANUAL SIGNALS
              </h2>
              <p>
                Jump to any fictional Aurora state to inspect the route. No wallet or network calls
                run.
              </p>
              <div className="deposit-lab-route-buttons">
                {routePhases.map((phase) => (
                  <button
                    key={phase.stage}
                    type="button"
                    aria-pressed={stage === phase.stage && crossChain}
                    onClick={() => jumpToRoute(phase.stage)}
                  >
                    {phase.label}
                  </button>
                ))}
              </div>
              <div className="deposit-lab-controls">
                <label>
                  Diagram appearance{" "}
                  <select
                    value={journeyAppearance}
                    onChange={(event) => setJourneyAppearance(event.target.value)}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={reduceJourneyMotion}
                    onChange={(event) => setReduceJourneyMotion(event.target.checked)}
                  />{" "}
                  Preview reduced motion
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={previewLiveAutoplay}
                    onChange={(event) => setPreviewLiveAutoplay(event.target.checked)}
                  />{" "}
                  Preview live autoplay
                </label>
              </div>
            </section>
          </details>
        </div>
        <section className="deposit-docket" aria-label="Simulated deposit flow">
          <div className="deposit-docket-topline">
            <h2>DEPOSIT / STRATEGY 01</h2>
            <span>{source.toUpperCase()} USDC → sdMON / MONAD</span>
          </div>
          <div className="deposit-docket-form">
            <DepositStepIndicator current={currentStep} includeSource />
            <div key={stage} className="deposit-stage-screen">
              {stage === "connect" ? (
                <div className="deposit-entry">
                  <div className="deposit-entry-badge">
                    01 <span>/</span> CONNECT
                  </div>
                  <h3>Where is your USDC?</h3>
                  <p>
                    Connect a wallet to find your supported USDC balances. Then choose a chain and
                    see the complete route before signing.
                  </p>
                  <button className="deposit-primary-action" onClick={() => setStage("source")}>
                    Get started ↗
                  </button>
                  <span className="deposit-entry-note">NO FUNDS MOVE WHEN YOU CONNECT</span>
                </div>
              ) : null}
              {stage === "source" ? (
                <div className="deposit-source-section">
                  <p className="deposit-kicker">01 / CHOOSE THE STARTING POINT</p>
                  <h3>Your USDC starts here.</h3>
                  <p>Choose the network where your USDC is held.</p>
                  <DepositSourceConstellation
                    sources={mockSources}
                    selectedId={sourceStar.id}
                    onSelect={(id) => {
                      const next = mockSources.find((item) => item.id === id);
                      if (!next) return;
                      if (source !== next.name) setAmount("");
                      setSource(next.name);
                      setStage("amount");
                    }}
                  />
                </div>
              ) : null}
              {stage === "amount" ? (
                <div className="deposit-form">
                  <DepositSelectedSource source={sourceStar} />
                  <div className="deposit-form-heading">
                    <div>
                      <span className="deposit-kicker">02 / SET THE AMOUNT</span>
                      <h3>Your USDC in.</h3>
                    </div>
                    <button
                      className="deposit-balance-button"
                      onClick={() => setAmount(String(sourceBalance))}
                    >
                      Use balance · {sourceBalance} USDC
                    </button>
                  </div>
                  <label className="deposit-amount-label">
                    <span className="sr-only">USDC amount</span>
                    <div className="deposit-amount-field">
                      <input
                        className="deposit-amount-input"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                      />
                      <span className="deposit-amount-unit">
                        USDC <small>{source.toUpperCase()}</small>
                      </span>
                    </div>
                  </label>
                  {Number(amount) > sourceBalance ? (
                    <p role="alert" className="mt-2 text-short">
                      More than your simulated balance.
                    </p>
                  ) : null}
                  {valid ? (
                    <div className="deposit-conversion">
                      <span className="deposit-conversion-arrow">↘</span>
                      <div>
                        <span className="deposit-kicker">YOUR ESTIMATED SHARES OUT</span>
                        <strong>
                          {(Number(amount) / 1.0129).toFixed(4)} <small>sdMON</small>
                        </strong>
                      </div>
                    </div>
                  ) : null}
                  <button
                    className="deposit-primary-action"
                    disabled={!valid}
                    onClick={() => setStage("review")}
                  >
                    Review route ↗
                  </button>
                  <button className="deposit-lab-back" onClick={() => setStage("source")}>
                    ← Change source
                  </button>
                </div>
              ) : null}
              {stage === "review" ? (
                <div className="deposit-review">
                  <div className="deposit-review-heading">
                    <span className="deposit-kicker">03 / REVIEW BEFORE SIGNING</span>
                    <button onClick={() => setStage("amount")}>Edit amount</button>
                  </div>
                  <h4>Check both sides.</h4>
                  <dl>
                    <div>
                      <dt>You send</dt>
                      <dd>
                        {amount} USDC on {source}
                      </dd>
                    </div>
                    <div>
                      <dt>Estimated shares</dt>
                      <dd>{(Number(amount) / 1.0129).toFixed(4)} sdMON</dd>
                    </div>
                    <div>
                      <dt>Destination</dt>
                      <dd>Monad vault</dd>
                    </div>
                    <div>
                      <dt>Vault entry fee</dt>
                      <dd>None</dd>
                    </div>
                  </dl>
                  <p className="deposit-review-note">
                    {crossChain
                      ? "The route needs a wallet authorization and source-chain transfer. Routing fees and share amount can change until settlement."
                      : "USDC approval and deposit are separate wallet transactions. Network gas is paid separately. Shares are an estimate until confirmation."}{" "}
                    sdMON represents your share of the whole vault. MON allocation and the
                    offsetting short happen separately after deposit.
                  </p>
                  <button className="deposit-primary-action" onClick={nextAfterReview}>
                    Start wallet authorization ↗
                  </button>
                </div>
              ) : null}
              {stage === "approval" ? (
                <div className="deposit-state deposit-state-pending">
                  <span className="deposit-state-symbol">↗</span>
                  <div>
                    <strong>
                      {crossChain ? "Sign route authorization" : "Approve USDC in your wallet"}
                    </strong>
                    <p>
                      {crossChain
                        ? "This signature authorizes the route. It does not move USDC yet."
                        : "Approval allows the vault to use this amount. It does not deposit yet."}
                    </p>
                    <button className="deposit-primary-action" onClick={finishApproval}>
                      Simulate wallet response ↗
                    </button>
                  </div>
                </div>
              ) : null}
              {stage === "deposit" ? (
                <div className="deposit-state deposit-state-pending">
                  <span className="deposit-state-symbol">↗</span>
                  <div>
                    <strong>
                      {crossChain ? `Send USDC on ${source}` : "Deposit USDC on Monad"}
                    </strong>
                    <p>
                      {crossChain
                        ? "The source transaction starts the route to Monad."
                        : "This is the transaction that enters the vault."}
                    </p>
                    <button className="deposit-primary-action" onClick={finishDeposit}>
                      Simulate transaction ↗
                    </button>
                  </div>
                </div>
              ) : null}
              {stage === "pending" ? (
                <div className="deposit-state deposit-state-pending">
                  <span className="deposit-state-symbol">↗</span>
                  <div>
                    <strong>
                      {crossChain ? "Routing USDC to Monad" : "Waiting for Monad confirmation"}
                    </strong>
                    <p>
                      Submitted is not confirmed. Keep the transaction visible until shares are
                      minted.
                    </p>
                    <button className="deposit-primary-action" onClick={() => setStage("success")}>
                      Simulate confirmed receipt ↗
                    </button>
                  </div>
                </div>
              ) : null}
              {routePhase ? (
                <div className="deposit-lab-route-state" data-appearance={journeyAppearance}>
                  <div className="deposit-lab-route-state-heading">
                    <span className="deposit-kicker">
                      SIMULATED AURORA STATUS / {routePhase.status}
                    </span>
                    <span>NO LIVE TRANSFER</span>
                  </div>
                  <DepositJourney
                    status={routePhase.status}
                    sourceName={source}
                    sourceTxSent={routePhase.sourceTxSent}
                    mintConfirmed={routePhase.mintConfirmed}
                    simulated
                    reducedMotion={reduceJourneyMotion}
                    strategyAutoPlayKey={
                      previewLiveAutoplay && routePhase.mintConfirmed
                        ? "lab-confirmed-deposit"
                        : undefined
                    }
                    onStrategyEnd={() => {
                      if (previewLiveAutoplay && stage === "success" && !routeStudy)
                        showReturnRouteAfterDeposit();
                    }}
                  />
                  <p className="deposit-lab-route-disclaimer">
                    This is a design preview. The live route only advances when Aurora, the vault,
                    and the share balance provide the corresponding confirmation.
                  </p>
                  {["source-sent", "routing", "arrived", "vault", "mint-check"].includes(stage) ? (
                    <button className="deposit-primary-action" onClick={advanceRoute}>
                      Simulate next status ↗
                    </button>
                  ) : null}
                  {stage === "route-failed" || stage === "expired" ? (
                    <button
                      className="deposit-primary-action"
                      onClick={() => jumpToRoute("source-sent")}
                    >
                      Restart route simulation ↗
                    </button>
                  ) : null}
                  {stage === "success" ? (
                    <button className="deposit-primary-action" onClick={reset}>
                      Start another simulation ↗
                    </button>
                  ) : null}
                </div>
              ) : null}
              {stage === "success" && !crossChain ? (
                <div role="status" className="deposit-state deposit-state-success">
                  <span className="deposit-state-symbol">✓</span>
                  <div>
                    <strong>{amount} USDC deposited.</strong>
                    <p>
                      The vault confirmed the deposit. This fictional wallet received approximately{" "}
                      {(Number(amount) / 1.0129).toFixed(4)} sdMON.
                    </p>
                    <button className="deposit-primary-action" onClick={reset}>
                      Start another simulation ↗
                    </button>
                  </div>
                </div>
              ) : null}
              {stage === "error" ? (
                <div role="alert" className="deposit-state deposit-state-error">
                  <span className="deposit-state-symbol">!</span>
                  <div>
                    <strong>
                      {errorAt === "approval"
                        ? "Wallet approval did not complete."
                        : "The deposit transaction failed."}
                    </strong>
                    <p>
                      Your {amount} USDC amount is still here. Check the issue and retry the same
                      step.
                    </p>
                    <button
                      className="deposit-primary-action"
                      onClick={() => setStage(errorAt === "approval" ? "approval" : "deposit")}
                    >
                      Retry this step ↗
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="deposit-docket-footer">
            <span>DELTAMON! / MONAD</span>
            <span>SIMULATED · NO TRANSACTIONS</span>
          </div>
        </section>
      </div>
      <section id="position" className="deposit-lab-return" aria-labelledby="return-route-title">
        <p className="deposit-kicker">THE RETURN ROUTE / SIMULATION</p>
        <h2 id="return-route-title" tabIndex={-1}>
          YOUR EXIT
          <br />
          <em>STAYS VISIBLE.</em>
        </h2>
        <p>
          This is the next chapter after a confirmed deposit. In the live app, your verified sdMON
          position and available exit liquidity appear here.
        </p>
        <div className="deposit-lab-return-track" aria-label="Simulated return route">
          <span>
            sdMON <small>YOUR SHARES</small>
          </span>
          <b aria-hidden="true">↘</b>
          <span>
            USDC <small>AVAILABLE IDLE CASH</small>
          </span>
        </div>
      </section>
    </main>
  );
}
