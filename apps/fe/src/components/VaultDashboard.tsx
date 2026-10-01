"use client";

import Image from "next/image";
import { BalanceEngine } from "./BalanceEngine";
import { StatsRow } from "./StatsRow";
import { HoldingsPanel } from "./HoldingsPanel";
import { DepositPanel } from "./DepositPanel";
import { PositionPanel } from "./PositionPanel";
import { useVaultStats } from "@/hooks/useVaultStats";
import { SHOW_TIPPET_LORE } from "@/lib/featureFlags";

export function VaultDashboard() {
  const { stats, isOffline, isLoading } = useVaultStats();
  return (
    <div className="counterweight-site">
      <section className="counter-hero" aria-labelledby="counter-hero-title">
        <div className="counter-hero-copy">
          <p className="counter-eyebrow">
            <span className="counter-spark" aria-hidden="true">
              ✳
            </span>{" "}
            Strategy 01 / MON vault
          </p>
          <h1 id="counter-hero-title">
            MON staked.
            <em>Short reported.</em>
          </h1>
          <p className="counter-hero-intro">
            Deposit USDC into a MON staking strategy and receive sdMON vault shares. DeltaMon pairs
            the MON position with an automated short that aims to reduce MON price exposure. See the
            position, latest short report, and available exit liquidity before you deposit.
          </p>
          <div className="counter-hero-actions">
            <a href="#vault" className="counter-primary">
              View the position <span aria-hidden="true">↗</span>
            </a>
            <a href="#how" className="counter-text-link">
              How it works <span aria-hidden="true">↗</span>
            </a>
          </div>
          <p className="counter-hero-footnote">
            The hedge targets low net MON exposure; actual exposure can change.
          </p>
          {SHOW_TIPPET_LORE ? (
            <a className="counter-meet-link" href="#meet-tippet">
              Meet Tippet, the little counterweight <span aria-hidden="true">↓</span>
            </a>
          ) : null}
        </div>
        <div className="counter-hero-art">
          <div className="counter-orbit" aria-hidden="true" />
          <div className="counter-art-label counter-art-label-top">
            {SHOW_TIPPET_LORE ? "TIPPET / THE LITTLE" : "THE LITTLE"}
            <br />
            COUNTERWEIGHT ↘
          </div>
          <Image
            src="/art/counterweight-mascot.png"
            alt="A purple counterweight character weighs a lavender stone against a small brass block."
            width={1536}
            height={1024}
            priority
            className="counter-mascot"
          />
          <div className="counter-art-label counter-art-label-bottom">
            MON HELD <span>↔</span> MON SHORT
            <br />
            <small>Shown separately</small>
          </div>
        </div>
        <div className="counter-hero-rail" aria-label="Vault basics">
          <span>
            <b>01</b> Built on Monad
          </span>
          <span>
            <b>02</b> USDC in · sdMON shares out
          </span>
          <span>
            <b>03</b> ±2% target band, when measured
          </span>
        </div>
      </section>

      <section className="counter-position" id="vault" aria-labelledby="counter-position-title">
        <div className="counter-section-heading">
          <div>
            <p className="counter-section-index">01 / THE REAL POSITION</p>
            <h2 id="counter-position-title">
              THE MON
              <br />
              <em>POSITION.</em>
            </h2>
          </div>
          <p>
            The vault&apos;s MON holdings are read onchain. The short&apos;s latest reported size
            appears beside them, with its update time. A current report lets you estimate the gap.
          </p>
        </div>
        <div className="counter-engine-wrap">
          {stats ? (
            <BalanceEngine stats={stats} />
          ) : (
            <div
              className="instrument-card flex min-h-[500px] flex-col items-center justify-center p-8 text-center"
              role="status"
            >
              {isOffline ? (
                <div className="counter-empty-mark mb-5" aria-hidden="true">
                  ?
                </div>
              ) : (
                <div
                  className="mb-5 size-20 rounded-full border-8 border-line border-t-monad"
                  aria-hidden="true"
                />
              )}
              <h3 className="text-2xl font-semibold">
                {isOffline ? "Live readings unavailable" : "Reading the vault"}
              </h3>
              <p className="text-muted mt-3 max-w-sm text-sm">
                {isOffline
                  ? "Current vault readings are unavailable. Try again shortly."
                  : "Fetching vault holdings and the latest short position report."}
              </p>
              {isLoading ? (
                <span className="font-data text-muted mt-4 text-xs">CONNECTING TO MONAD</span>
              ) : null}
            </div>
          )}
        </div>
        {stats ? (
          <div className="counter-stats">
            <StatsRow stats={stats} />
            {stats.source === "demo" ? (
              <p className="mt-4 text-xs font-medium" style={{ color: "var(--exposure-short)" }}>
                Example figures. Live readings require a deployed vault and a short position report.
              </p>
            ) : null}
            <details className="counter-composition" id="vault-composition">
              <summary>
                <span>
                  <strong>Vault composition</strong>
                  <small>MON, idle USDC, and the short account</small>
                </span>
                <span aria-hidden="true">↗</span>
              </summary>
              <HoldingsPanel stats={stats} />
            </details>
          </div>
        ) : null}
      </section>

      <section className="counter-action-section" aria-labelledby="counter-action-title">
        <div className="counter-section-heading">
          <div>
            <p className="counter-section-index">02 / YOUR MOVE</p>
            <h2 id="counter-action-title">
              Ready when
              <br />
              <em>you are.</em>
            </h2>
          </div>
          <p>
            Start with USDC. Review the route and expected shares before your wallet signs. A
            deposit is complete only when the vault confirms it.{" "}
            <a href="#risks" className="underline underline-offset-2">
              Read the risks before depositing.
            </a>
          </p>
        </div>
        <div id="deposit" className="counter-deposit-wrap">
          <DepositPanel />
        </div>
      </section>
      <section id="position" className="counter-your-position">
        <PositionPanel />
      </section>
      {/* <div className="counter-console-link border-line flex flex-wrap items-center justify-between gap-3 border-t py-7 text-sm">
        <p className="text-muted">Inspect the underlying vault and all operational controls.</p>
        <Link href="/console" className="text-monad font-semibold underline underline-offset-4">
          Open vault console ↗
        </Link>
      </div> */}
    </div>
  );
}
