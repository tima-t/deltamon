"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, isAddress } from "viem";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { chainById } from "@deltamon/shared";
import {
  addr,
  agoText,
  big,
  bool,
  explorerUrl,
  fmtBps,
  fmtMon,
  fmtPrice,
  fmtShares,
  fmtSignedUsdc,
  fmtUsdc,
  int,
  shortAddr,
  untilText,
  useVaultAction,
  useVaultAddress,
  useVaultState,
} from "@/lib/vault";
import { AdminPanel } from "./AdminPanel";
import { KeeperPanel } from "./KeeperPanel";
import { QueuePanel } from "./QueuePanel";
import { UserPanel } from "./UserPanel";
import { Card, Pill, Stat, TxBanner } from "./ui";

type Tab = "overview" | "deposit" | "queue" | "admin" | "keeper";

export function VaultConsole() {
  const {
    address: account,
    chain: walletChain,
    chainId: walletChainId,
    isConnected,
  } = useAccount();
  const {
    switchChainAsync,
    isPending: networkSwitchPending,
    isError: networkSwitchFailed,
  } = useSwitchChain();
  const lastAutoSwitch = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const { address: vault, fallback, chainId, ready, isOverride, save, clear } = useVaultAddress();
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<Tab>("overview");

  const { state, refetch, failed } = useVaultState(vault, chainId);
  const onConfirmed = useCallback(() => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
    void queryClient.invalidateQueries({ queryKey: ["readContract"] });
  }, [refetch, queryClient]);
  const action = useVaultAction(vault, chainId, onConfirmed);
  const busy = action.busy || networkSwitchPending;

  useEffect(() => {
    if (!account) {
      lastAutoSwitch.current = null;
      return;
    }
    if (!vault || !addr(state.asset) || walletChainId === undefined) return;
    if (walletChainId === chainId) {
      lastAutoSwitch.current = null;
      return;
    }

    const attempt = `${account.toLowerCase()}:${vault.toLowerCase()}:${chainId}:${walletChainId}`;
    if (lastAutoSwitch.current === attempt) return;
    lastAutoSwitch.current = attempt;
    void switchChainAsync({ chainId }).catch(() => {
      // Keep the console usable. The next vault action can request the switch again.
    });
  }, [account, vault, state.asset, walletChainId, chainId, switchChainAsync]);

  const owner = addr(state.owner);
  const keeper = addr(state.keeper);
  const pendingOwner = addr(state.pendingOwner);
  const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const isOwner = same(account, owner);
  const isKeeper = same(account, keeper);
  const explorer = explorerUrl(chainId, "tx", "").replace(/\/tx\/$/, "");

  const ausd = addr(state.ausd);
  const { data: ausdHeld } = useReadContract({
    address: ausd,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: vault ? [vault] : undefined,
    chainId,
    query: { enabled: Boolean(ausd && vault) },
  });

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "overview", label: "Overview", show: true },
    { id: "deposit", label: "Deposit & withdraw", show: true },
    { id: "queue", label: "Queue", show: true },
    { id: "admin", label: "Admin", show: isOwner },
    { id: "keeper", label: "Keeper", show: isKeeper || isOwner },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
      <h1 className="pt-4 text-3xl font-semibold tracking-tight">Vault console</h1>
      <p className="text-muted mt-2 max-w-2xl">
        Point this at a DeltaMonVault and drive it directly from your wallet. What you can do
        depends on the address you connect with.
      </p>

      {/* address bar */}
      <div className="border-line bg-surface mt-6 rounded-xl border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1">
            <span className="text-muted text-xs">Vault address</span>
            <input
              value={draft}
              placeholder={vault ?? "0x…"}
              onChange={(e) => setDraft(e.target.value.trim())}
              className="border-line focus:border-monad mt-1 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm outline-none"
            />
          </label>
          <button
            type="button"
            disabled={!isAddress(draft)}
            onClick={() => {
              if (save(draft)) setDraft("");
            }}
            className="bg-monad hover:bg-monad-deep rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            Use this vault
          </button>
          {isOverride ? (
            <button
              type="button"
              onClick={() => clear()}
              className="border-line hover:border-ink rounded-md border px-3 py-2 text-sm"
            >
              Reset to {shortAddr(fallback)}
            </button>
          ) : null}
        </div>

        <div className="text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            Vault{" "}
            {vault ? (
              <a
                href={explorerUrl(chainId, "address", vault)}
                target="_blank"
                rel="noreferrer"
                className="font-mono underline underline-offset-2"
              >
                {shortAddr(vault)}
              </a>
            ) : (
              "not set"
            )}
          </span>
          <span>Oracle {shortAddr(addr(state.oracle))}</span>
          <span>Venue {shortAddr(addr(state.spotVenue))}</span>
          <span>Chain {chainId}</span>
          {isConnected ? (
            <span className="flex items-center gap-2">
              You are
              {isOwner ? <Pill tone="good">admin</Pill> : null}
              {isKeeper ? <Pill tone="good">keeper</Pill> : null}
              {!isOwner && !isKeeper ? <Pill tone="flat">depositor</Pill> : null}
            </span>
          ) : (
            <span>Connect a wallet to act</span>
          )}
        </div>

        {ready && !vault ? (
          <p className="text-short mt-2 text-sm">
            No vault for chain {chainId} yet. Paste the address above.
          </p>
        ) : null}
        {failed ? (
          <p className="text-short mt-2 text-sm">
            That address did not answer as a DeltaMonVault on chain {chainId}.
          </p>
        ) : null}
        {isConnected && walletChainId !== chainId ? (
          <p className="text-short mt-2 text-sm">
            Wallet is on {walletChain?.name ?? `chain ${walletChainId}`}. This vault is on{" "}
            {chainById(chainId).name}.{" "}
            {networkSwitchPending
              ? "Confirm the network switch in your wallet."
              : networkSwitchFailed
                ? "The automatic switch was declined. A vault action can request it again."
                : "Your wallet will be asked to switch networks."}
          </p>
        ) : null}
        {same(pendingOwner, account) && !isOwner ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => action.run("acceptOwnership", [], "accept ownership")}
            className="border-line hover:border-ink mt-3 rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Accept ownership
          </button>
        ) : null}
      </div>

      {/* tabs */}
      <div className="border-line mt-6 flex flex-wrap gap-1 border-b">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === t.id ? "border-monad text-ink" : "text-muted border-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
      </div>

      <div className="mt-6">
        {tab === "overview" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="The book">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Total assets" value={`${fmtUsdc(big(state.totalAssets))} USDC`} />
                <Stat
                  label="Price per share"
                  value={fmtUsdc(big(state.pricePerShare))}
                  hint={`${fmtShares(big(state.totalSupply))} sdMON out`}
                />
                <Stat label="Idle USDC" value={fmtUsdc(big(state.usdcBalance))} />
                <Stat
                  label="Free for exits"
                  value={fmtUsdc(big(state.availableLiquidity))}
                  hint={`${fmtUsdc(big(state.accruedFees))} owed in fees`}
                />
                <Stat
                  label="MON"
                  value={fmtMon(big(state.totalMon))}
                  hint={`${fmtMon(big(state.stakedMon))} staked · ${fmtMon(big(state.unstakingMon))} unbonding`}
                />
                <Stat
                  label="MON price"
                  value={`$${fmtPrice(big(state.monPrice))}`}
                  hint={
                    bool(state.oracleIsLive) ? "oracle live" : "oracle down: in-kind exits are open"
                  }
                />
                <Stat
                  label="AUSD held"
                  value={fmtUsdc(typeof ausdHeld === "bigint" ? ausdHeld : 0n)}
                />
                <Stat
                  label="Perp book"
                  value={`${fmtUsdc(big(state.perpEquity))} USDC`}
                  hint={`${fmtUsdc(big(state.perpDeployed))} sent · mark ${fmtSignedUsdc(big(state.perpReportedPnl))}`}
                />
              </div>
            </Card>

            <Card title="Settings and roles">
              <div className="grid grid-cols-2 gap-4">
                <Stat
                  label="Deposit cap"
                  value={`${fmtUsdc(big(state.depositCap))} USDC`}
                  hint={`minimum ${fmtUsdc(big(state.minDeposit))}`}
                />
                <Stat label="Performance fee" value={fmtBps(int(state.performanceFeeBps))} />
                <Stat label="Perp ceiling" value={fmtBps(int(state.maxPerpAllocationBps))} />
                <Stat label="Swap slippage cap" value={fmtBps(int(state.maxSwapSlippageBps))} />
                <Stat
                  label="Perp mark"
                  value={
                    bool(state.perpReportIsStale) ? (
                      <Pill tone="warn">stale</Pill>
                    ) : (
                      <Pill tone="good">fresh</Pill>
                    )
                  }
                  hint={`marked ${agoText(big(state.perpReportedAt))}`}
                />
                <Stat
                  label="Queue"
                  value={
                    bool(state.hasOverdueRedemptions) ? (
                      <Pill tone="warn">needs attention</Pill>
                    ) : (
                      <Pill tone="good">healthy</Pill>
                    )
                  }
                  hint={`${big(state.redemptionCount).toString()} requests`}
                />
                <Stat label="Admin" value={shortAddr(owner)} />
                <Stat label="Keeper" value={shortAddr(keeper)} />
                <Stat
                  label="Paused"
                  value={bool(state.paused) ? <Pill tone="warn">paused</Pill> : "no"}
                />
                <Stat label="Whitelist" value={bool(state.whitelistEnabled) ? "on" : "off"} />
              </div>
              <div className="text-muted space-y-1 text-sm">
                <div>Fee change: {untilText(big(state.pendingFeeEffectiveAt))}</div>
                <div>Perp ceiling change: {untilText(big(state.pendingMaxPerpAllocationAt))}</div>
                <div>Risk limit change: {untilText(big(state.pendingRiskParamsAt))}</div>
                <div>Venue change: {untilText(big(state.venueEffectiveAt))}</div>
              </div>
            </Card>
          </div>
        ) : null}

        {vault && tab === "deposit" ? (
          <UserPanel vault={vault} chainId={chainId} state={state} busy={busy} run={action.run} />
        ) : null}

        {vault && tab === "queue" ? (
          <QueuePanel vault={vault} chainId={chainId} state={state} busy={busy} run={action.run} />
        ) : null}

        {vault && tab === "admin" && isOwner ? (
          <AdminPanel vault={vault} chainId={chainId} state={state} busy={busy} run={action.run} />
        ) : null}

        {vault && tab === "keeper" && (isKeeper || isOwner) ? (
          <KeeperPanel state={state} busy={busy} isOwner={isOwner} run={action.run} />
        ) : null}
      </div>

      <TxBanner
        label={action.label}
        hash={action.hash}
        error={action.error}
        confirmed={action.confirmed}
        explorer={explorer}
      />
    </div>
  );
}
