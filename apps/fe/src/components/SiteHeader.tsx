"use client";

import Link from "next/link";
import Image from "next/image";
import { useAccount } from "wagmi";
import { ThemeToggle } from "./ThemeToggle";
import { useWalletEntry } from "./WalletEntry";

export function SiteHeader() {
  const { address, isConnected } = useAccount();
  const { openEntry, openAccount, isPasskey } = useWalletEntry();

  return (
    <header className="site-header counter-header mx-auto w-full max-w-7xl">
      <div className="counter-header-register" aria-hidden="true">
        <span>
          STRATEGY 01 <span className="counter-register-slash">/</span> MONAD
        </span>
        <span className="counter-header-beam">
          <i />
          <i />
        </span>
        <span>THE BALANCE ENGINE</span>
      </div>

      <div className="counter-header-main">
        <Link href="/" className="counter-brand" aria-label="DeltaMon home">
          <span className="counter-brand-stamp">
            <Image src="/brand/deltamon-mark.svg" alt="" width={48} height={48} />
          </span>
          <span className="counter-brand-copy">
            <span className="counter-brand-name">
              DELTAMON<span className="counter-brand-punctuation">!</span>
            </span>
            <span className="counter-brand-subtitle">TWO SIDES, IN VIEW</span>
          </span>
        </Link>

        <nav className="counter-header-nav" aria-label="Primary navigation">
          <Link href="/#vault" className="counter-header-link">
            <span className="counter-header-link-index">01</span>
            <span>The position</span>
          </Link>
          <Link href="/#deposit" className="counter-header-link">
            <span className="counter-header-link-index">02</span>
            <span>Deposit</span>
          </Link>
          <Link href="/console" className="counter-header-link">
            <span className="counter-header-link-index">03</span>
            <span>Console</span>
          </Link>
        </nav>

        <div className="counter-header-actions">
          <ThemeToggle />
          <button
            type="button"
            onClick={isConnected ? openAccount : openEntry}
            className="button-primary counter-header-wallet"
            aria-label={
              isConnected && address
                ? `Open ${isPasskey ? "passkey" : "connected"} wallet ${address.slice(0, 6)}…${address.slice(-4)}`
                : undefined
            }
          >
            {isConnected && address ? (
              <span>
                <span className="counter-wallet-type">
                  {isPasskey ? "Passkey · " : "Wallet · "}
                </span>
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
            ) : (
              <span>Get started</span>
            )}
            <span className="counter-wallet-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
