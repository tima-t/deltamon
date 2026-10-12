"use client";

import Image from "next/image";
import { HedgeStatus } from "./HedgeStatus";
import { VaultPerformance } from "./VaultPerformance";
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
        <div className="printmaker-hero-art">
          <Image
            src="/art/printmaker.png"
            alt="A violet printmaker holds a brass-handled ink roller and inspects a fresh cream proof sheet."
            width={1280}
            height={1280}
            sizes="(max-width: 700px) 100vw, 50vw"
            preload
            className="printmaker-hero-image"
          />
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
            <HedgeStatus stats={stats} />
          ) : (
            <div className="hedge-strip hedge-strip-empty" role="status">
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
        <VaultPerformance stats={stats} />
      </section>

      <section className="counter-action-section" aria-labelledby="counter-action-title">
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
