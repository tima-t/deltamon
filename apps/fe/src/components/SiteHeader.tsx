"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

export function SiteHeader() {
  const { chain, isConnected } = useAccount();

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
      <Link href="/" className="text-xl font-semibold tracking-tight">
        DeltaMon
      </Link>
      <div className="flex items-center gap-4">
        <Link href="/console" className="text-muted hover:text-ink text-sm">
          Console
        </Link>
        <span className="text-muted hidden text-sm sm:inline">
          {isConnected ? (chain?.name ?? "Connected") : "Monad"}
        </span>
        <ConnectButton.Custom>
          {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
            const action =
              !mounted || !account
                ? openConnectModal
                : chain?.unsupported
                  ? openChainModal
                  : openAccountModal;
            const label =
              !mounted || !account
                ? "Connect Wallet"
                : chain?.unsupported
                  ? "Switch Network"
                  : `${account.address.slice(0, 6)}…${account.address.slice(-4)}`;

            return (
              <button
                type="button"
                disabled={!mounted}
                onClick={action}
                className="bg-monad hover:bg-monad-deep rounded-lg px-3 py-2 text-sm font-medium text-white transition-colors disabled:cursor-wait disabled:opacity-70"
              >
                {label}
              </button>
            );
          }}
        </ConnectButton.Custom>
      </div>
    </header>
  );
}
