"use client";

import Link from "next/link";
import Image from "next/image";
import { useAccount } from "wagmi";
import { ThemeToggle } from "./ThemeToggle";
import { useWalletEntry } from "./WalletEntry";

export function SiteHeader() {
  const { address, chain, isConnected } = useAccount();
  const { openEntry, openAccount, isPasskey } = useWalletEntry();

  return (
    <header className="site-header counter-header mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
      <Link
        href="/"
        className="counter-brand flex items-center gap-2.5 text-xl font-semibold tracking-tight"
        aria-label="DeltaMon home"
      >
        <Image src="/brand/deltamon-mark.svg" alt="" width={38} height={38} />
        <span>
          DELTAMON<span className="counter-brand-punctuation">!</span>
        </span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-4">
        <Link href="/#vault" className="counter-header-link hidden text-sm md:inline">
          The position
        </Link>
        {/* <Link href="/#how" className="counter-header-link hidden text-sm lg:inline">
          How it works
        </Link> */}
        <Link href="/console" className="text-muted hover:text-ink hidden text-sm sm:inline">
          Console
        </Link>
        {/* <span className="text-muted hidden text-sm lg:inline">
          {isConnected ? (chain?.name ?? "Connected") : "Monad"}
        </span> */}
        <ThemeToggle />
        <button
          type="button"
          onClick={isConnected ? openAccount : openEntry}
          className="button-primary rounded-lg px-3 py-2 text-xs font-semibold sm:text-sm"
        >
          {isConnected && address
            ? `${isPasskey ? "Passkey · " : ""}${address.slice(0, 6)}…${address.slice(-4)}`
            : "Get started"}
        </button>
      </div>
    </header>
  );
}
