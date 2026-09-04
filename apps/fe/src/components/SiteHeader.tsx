"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { isSupportedChainId } from "@deltamon/shared";

export function SiteHeader() {
  const { chain, isConnected } = useAccount();
  const wrongNetwork = isConnected && chain && !isSupportedChainId(chain.id);

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
      <a href="#top" className="text-xl font-semibold tracking-tight">
        DeltaMon
      </a>
      <div className="flex items-center gap-4">
        {wrongNetwork ? (
          <span className="text-short text-sm">Switch to Monad to deposit</span>
        ) : (
          <span className="text-muted hidden text-sm sm:inline">{chain?.name ?? "Monad"}</span>
        )}
        <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
      </div>
    </header>
  );
}
