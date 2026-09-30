"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi } from "viem";
import { useAccount, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { chainById } from "@deltamon/shared";
import {
  VAULT_ABI,
  addr,
  explorerUrl,
  shortAddr,
  useVaultAction,
  useVaultAddress,
  useVaultState,
} from "@/lib/vault";
import { AdminPanel } from "./AdminPanel";
import { KeeperPanel } from "./KeeperPanel";
import { ManagerPanel } from "./ManagerPanel";
import { PerpPositionPanel } from "./PerpPositionPanel";
import { AutomationPanel } from "./AutomationPanel";
import { ActivityPanel } from "./ActivityPanel";
import { UserPanel } from "./UserPanel";
import { Pill, TxBanner } from "./ui";
import { ConsoleOverview } from "./ConsoleOverview";
import { VaultArtwork } from "./VaultArtwork";

type Tab =
  "overview" | "deposit" | "activity" | "manager" | "perp" | "automations" | "admin" | "keeper";

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
  const { address: vault, selectedId, vaults, select, chainId } = useVaultAddress();
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

  // The manager tab is for whoever holds the role, so it is keyed off the connected address.
  const { data: managerStanding } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: vault, abi: VAULT_ABI, functionName: "isPerpManager", args: [account], chainId },
      {
        address: vault,
        abi: VAULT_ABI,
        functionName: "perpManagerOutstanding",
        args: [account],
        chainId,
      },
    ],
    query: { enabled: Boolean(vault && account), refetchInterval: 12_000 },
  });
  const isManager =
    (managerStanding?.[0]?.status === "success" && managerStanding[0].result === true) ||
    (managerStanding?.[1]?.status === "success" &&
      typeof managerStanding[1].result === "bigint" &&
      managerStanding[1].result > 0n);

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
    { id: "activity", label: "Activity", show: true },
    { id: "manager", label: "Return capital", show: isManager },
    { id: "perp", label: "Perp position", show: isManager || isOwner },
    { id: "automations", label: "Automations", show: isOwner },
    { id: "admin", label: "Admin", show: isOwner },
    { id: "keeper", label: "Keeper", show: isKeeper || isOwner },
  ];

  return (
    <div className="console-page mx-auto w-full max-w-7xl px-5 pb-20 sm:px-8">
      <div className="console-intro">
        <div>
          <span className="console-index">DELTAMON / OPERATIONS</span>
          <h1>
            Vault console<span className="console-title-mark">.</span>
          </h1>
        </div>
        <p>
          Read the book, check what is available for exits, and act from your connected wallet.
          Controls follow your onchain role.
        </p>
      </div>

      <section className="console-selector" aria-labelledby="console-selector-title">
        <div className="console-selector-heading">
          <div>
            <span className="console-index">SELECTED INSTRUMENT</span>
            <h2 id="console-selector-title">Choose a vault</h2>
          </div>
          <span className="console-selector-count">
            {String(vaults.length).padStart(2, "0")} SUPPORTED
          </span>
        </div>
        {vaults.length ? (
          <div className="console-vault-list">
            {vaults.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={selectedId === entry.id}
                onClick={() => select(entry.id)}
                className="console-vault-choice"
              >
                <span className="console-vault-art-wrap">
                  <VaultArtwork />
                  <span className="console-vault-art-caption">DM / 01</span>
                </span>
                <span className="console-vault-copy">
                  <span className="console-vault-kicker">
                    {entry.strategy} <span>·</span> {chainById(chainId).name}
                  </span>
                  <strong>{entry.name}</strong>
                  <span className="console-vault-description">
                    MON exposure and a manager run hedge, viewed as one vault book.
                  </span>
                  <span className="console-vault-address">
                    {shortAddr(entry.address)} <span aria-hidden="true">↗</span>
                  </span>
                </span>
                <span className="console-vault-selected">
                  <span className="console-selected-dot" />
                  {selectedId === entry.id ? "VIEWING" : "SELECT"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="console-vault-empty">
            No supported vault is configured on {chainById(chainId).name}.
          </p>
        )}
        <div className="console-vault-meta">
          <span>
            VAULT{" "}
            <a
              href={vault ? explorerUrl(chainId, "address", vault) : undefined}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddr(vault)}
            </a>
          </span>
          <span>ORACLE {shortAddr(addr(state.oracle))}</span>
          <span>VENUE {shortAddr(addr(state.spotVenue))}</span>
          <span>CHAIN {chainId}</span>
          <span className="console-vault-role">
            {isConnected ? (
              <>
                YOUR ACCESS {isOwner ? <Pill tone="good">admin</Pill> : null}
                {isKeeper ? <Pill tone="good">keeper</Pill> : null}
                {!isOwner && !isKeeper ? <Pill tone="flat">depositor</Pill> : null}
              </>
            ) : (
              "CONNECT A WALLET TO ACT"
            )}
          </span>
        </div>

        {failed ? (
          <p className="text-short mt-3 text-sm" role="alert">
            This supported vault did not answer as a DeltaMonVault on chain {chainId}.
          </p>
        ) : null}
        {isConnected && walletChainId !== chainId ? (
          <p className="text-short mt-3 text-sm" role="status">
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
            className="console-accept-owner mt-3 disabled:opacity-50"
          >
            Accept ownership
          </button>
        ) : null}
      </section>

      {/* tabs */}
      <nav className="console-tabs" aria-label="Vault console sections">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={tab === t.id ? "is-active" : ""}
            >
              {t.label}
            </button>
          ))}
      </nav>

      <div className="mt-6">
        {tab === "overview" ? <ConsoleOverview state={state} ausdHeld={ausdHeld} /> : null}

        {vault && tab === "deposit" ? (
          <UserPanel vault={vault} chainId={chainId} state={state} busy={busy} run={action.run} />
        ) : null}

        {vault && tab === "manager" && isManager ? (
          <ManagerPanel
            vault={vault}
            chainId={chainId}
            state={state}
            busy={busy}
            run={action.run}
          />
        ) : null}

        {tab === "perp" && (isManager || isOwner) ? <PerpPositionPanel /> : null}

        {tab === "activity" ? <ActivityPanel /> : null}

        {tab === "automations" && isOwner ? <AutomationPanel /> : null}

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
