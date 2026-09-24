"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { formatUnits, isAddress, parseUnits, type Abi, type Address, type Hex } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { chainById, deltaMonVaultAbi, getDeployment, isSupportedChainId } from "@deltamon/shared";
import { describeRevert } from "@/lib/revert";
import { DEFAULT_CHAIN_ID } from "@/lib/wagmi";
import { MERA_CONNECTOR_ID } from "@/lib/meraConnector";
import { assertContractGas } from "@/lib/nativeGas";

/** Typed as a plain Abi on purpose: the console addresses functions by name, not by literal type. */
export const VAULT_ABI = deltaMonVaultAbi as Abi;
export const USDC_DECIMALS = 6;

/** Every no-argument view the console shows, read in one multicall. */
export const VAULT_READS = [
  "asset",
  "decimals",
  "totalAssets",
  "totalSupply",
  "pricePerShare",
  "usdcBalance",
  "availableLiquidity",
  "totalMon",
  "stakedMon",
  "unstakingMon",
  "monPrice",
  "oracleIsLive",
  "perpDeployed",
  "perpEquity",
  "perpReportedPnl",
  "perpReportedAt",
  "perpReportIsStale",
  "perpReportMaxAge",
  "perpPnlBandBps",
  "maxPerpAllocationBps",
  "pendingMaxPerpAllocationBps",
  "pendingMaxPerpAllocationAt",
  "performanceFeeBps",
  "pendingPerformanceFeeBps",
  "pendingFeeEffectiveAt",
  "accruedFees",
  "depositCap",
  "minDeposit",
  "paused",
  "whitelistEnabled",
  "owner",
  "pendingOwner",
  "keeper",
  "queueHead",
  "redemptionCount",
  "queuedShares",
  "hasOverdueRedemptions",
  "maxSwapSlippageBps",
  "stableParityBandBps",
  "maxValidatorCommission",
  "pendingRiskParamsAt",
  "venueEffectiveAt",
  "spotVenue",
  "oracle",
  "wmon",
  "ausd",
  "CONFIG_TIMELOCK",
  "FEE_TIMELOCK",
  "REDEMPTION_DEADLINE",
] as const;

export type VaultReadName = (typeof VAULT_READS)[number];
export type VaultState = Partial<Record<VaultReadName, unknown>>;

// ── reading values back out of an untyped multicall ──

export const big = (v: unknown): bigint => (typeof v === "bigint" ? v : 0n);
export const maybeBig = (v: unknown): bigint | undefined => (typeof v === "bigint" ? v : undefined);
export const bool = (v: unknown): boolean => v === true;
export const addr = (v: unknown): Address | undefined =>
  typeof v === "string" && isAddress(v) ? (v as Address) : undefined;
export const int = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : 0;

// ── formatting ──

const fmt = (v: bigint | undefined, decimals: number, max: number) =>
  v === undefined
    ? "—"
    : Number(formatUnits(v, decimals)).toLocaleString(undefined, { maximumFractionDigits: max });

export const fmtUsdc = (v?: bigint) => fmt(v, USDC_DECIMALS, 2);
export const fmtMon = (v?: bigint) => fmt(v, 18, 2);
export const fmtShares = (v?: bigint) => fmt(v, 18, 2);
export const fmtPrice = (v?: bigint) => fmt(v, 18, 4);
export const fmtBps = (v?: number) => (v === undefined ? "—" : `${(v / 100).toFixed(2)}%`);
export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export const fmtSignedUsdc = (v?: bigint) =>
  v === undefined ? "—" : `${v < 0n ? "−" : "+"}${fmtUsdc(v < 0n ? -v : v)}`;

const DAY = 86_400;

function duration(seconds: number): string {
  if (seconds >= DAY) return `${Math.floor(seconds / DAY)}d ${Math.floor((seconds % DAY) / 3600)}h`;
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${Math.max(seconds, 0)}s`;
}

/** "ready" once the timelock has passed, otherwise how long is left. */
export function untilText(effectiveAt?: bigint): string {
  if (!effectiveAt || effectiveAt === 0n) return "nothing pending";
  const left = Number(effectiveAt) - Math.floor(Date.now() / 1000);
  return left <= 0 ? "ready to apply" : `ready in ${duration(left)}`;
}

/** Whether a pending timelock has matured. Zero means nothing is pending, so nothing to apply. */
export function timelockReady(effectiveAt?: bigint): boolean {
  if (!effectiveAt || effectiveAt === 0n) return false;
  return Math.floor(Date.now() / 1000) >= Number(effectiveAt);
}

/** When a pending timelock matures, in the reader's own timezone. */
export function readyAtText(effectiveAt?: bigint): string {
  if (!effectiveAt || effectiveAt === 0n) return "";
  return new Date(Number(effectiveAt) * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function agoText(timestamp?: bigint): string {
  if (!timestamp || timestamp === 0n) return "never";
  return `${duration(Math.floor(Date.now() / 1000) - Number(timestamp))} ago`;
}

export function explorerUrl(chainId: number, kind: "tx" | "address", value: string): string {
  const base = chainById(chainId).blockExplorers?.default.url;
  return base ? `${base}/${kind}/${value}` : "";
}

// ── the vault the console is pointed at ──

const storageKey = (chainId: number) => `deltamon.vault.${chainId}`;

/** localStorage as an external store, so reading it needs no render-time effect. */
const listeners = new Set<() => void>();

function subscribeToStored(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function announceStoredChange() {
  for (const listener of listeners) listener();
}

function readStored(chainId: number): Address | null {
  try {
    const saved = window.localStorage.getItem(storageKey(chainId));
    return saved && isAddress(saved) ? (saved as Address) : null;
  } catch {
    // private browsing with storage blocked
    return null;
  }
}

export function useVaultChainId(): number {
  const { chainId } = useAccount();
  return chainId !== undefined && isSupportedChainId(chainId) ? chainId : DEFAULT_CHAIN_ID;
}

export function useVaultAddress() {
  const chainId = useVaultChainId();
  const stored = useSyncExternalStore(
    subscribeToStored,
    () => readStored(chainId),
    () => null,
  );
  // False on the server and through hydration, so nothing flashes before storage is readable.
  const ready = useSyncExternalStore(
    subscribeToStored,
    () => true,
    () => false,
  );

  const fromEnv = process.env.NEXT_PUBLIC_VAULT_ADDRESS;
  const fallback =
    fromEnv && isAddress(fromEnv) ? (fromEnv as Address) : getDeployment(chainId)?.vault;

  const save = useCallback(
    (next: string) => {
      if (!isAddress(next)) return false;
      try {
        window.localStorage.setItem(storageKey(chainId), next);
      } catch {
        // nothing persisted, but the console still points at it for this session
      }
      announceStoredChange();
      return true;
    },
    [chainId],
  );

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKey(chainId));
    } catch {
      // nothing to clear
    }
    announceStoredChange();
  }, [chainId]);

  return {
    address: stored ?? fallback,
    fallback,
    chainId,
    ready,
    isOverride: stored !== null,
    save,
    clear,
  };
}

export function useVaultState(vault: Address | undefined, chainId: number) {
  const query = useReadContracts({
    allowFailure: true,
    contracts: VAULT_READS.map((functionName) => ({
      address: vault,
      abi: VAULT_ABI,
      functionName,
      chainId,
    })),
    query: { enabled: Boolean(vault), refetchInterval: 12_000 },
  });

  const state = useMemo(() => {
    const out: VaultState = {};
    VAULT_READS.forEach((name, i) => {
      const entry = query.data?.[i];
      if (entry && entry.status === "success") out[name] = entry.result;
    });
    return out;
  }, [query.data]);

  const failed = Boolean(query.data) && Object.keys(state).length === 0;
  return { state, refetch: query.refetch, isLoading: query.isLoading, failed };
}

// ── sending a transaction ──

export function useVaultAction(
  vault: Address | undefined,
  vaultChainId: number,
  onConfirmed?: () => void,
) {
  const { address: accountAddress, chainId: walletChainId, connector } = useAccount();
  const publicClient = usePublicClient({ chainId: vaultChainId });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending, reset } = useWriteContract();
  const [preparing, setPreparing] = useState(false);
  const [hash, setHash] = useState<Hex | undefined>();
  const [label, setLabel] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const receipt = useWaitForTransactionReceipt({
    chainId: vaultChainId,
    hash,
    query: { enabled: Boolean(hash) },
  });
  const receiptIsCurrent = Boolean(
    hash && receipt.data?.transactionHash.toLowerCase() === hash.toLowerCase(),
  );
  const confirmed = receiptIsCurrent && receipt.data?.status === "success";
  const reverted = receiptIsCurrent && receipt.data?.status === "reverted";

  useEffect(() => {
    if (confirmed) onConfirmed?.();
  }, [confirmed, onConfirmed]);

  const run = useCallback(
    async (
      functionName: string,
      args: readonly unknown[],
      what: string,
      options?: { target?: Address; abi?: Abi },
    ) => {
      const target = options?.target ?? vault;
      if (!target) return;
      setError(undefined);
      setLabel(what);
      setHash(undefined);
      reset();
      setPreparing(true);
      try {
        const code = vault ? await publicClient?.getCode({ address: vault }) : undefined;
        if (!code || code === "0x") {
          throw new Error(
            `No vault contract at ${vault ?? "this address"} on ${chainById(vaultChainId).name}.`,
          );
        }
        if (walletChainId !== vaultChainId) {
          await switchChainAsync({ chainId: vaultChainId });
        }
        if (connector?.id === MERA_CONNECTOR_ID && accountAddress) {
          await assertContractGas(chainById(vaultChainId), accountAddress, {
            address: target,
            abi: options?.abi ?? VAULT_ABI,
            functionName,
            args,
          } as Parameters<typeof assertContractGas>[2]);
        }
        const sent = await writeContractAsync({
          address: target,
          abi: options?.abi ?? VAULT_ABI,
          chainId: vaultChainId,
          functionName,
          args,
        } as Parameters<typeof writeContractAsync>[0]);
        setHash(sent);
      } catch (err) {
        setError(describeRevert(err));
      } finally {
        setPreparing(false);
      }
    },
    [vault, vaultChainId, walletChainId, accountAddress, connector, publicClient, switchChainAsync, writeContractAsync, reset],
  );

  return {
    run,
    hash,
    label,
    error:
      error ??
      (reverted
        ? "The transaction reverted onchain. Your position was not changed."
        : receipt.isError
          ? describeRevert(receipt.error)
          : undefined),
    busy: preparing || isPending || receipt.isLoading,
    preparing,
    awaitingWallet: isPending,
    awaitingChain: Boolean(hash) && receipt.isLoading,
    confirmed,
    receipt: receipt.data,
  };
}

// ── parsing what people type ──

export type FieldKind = "usdc" | "mon" | "shares" | "wad" | "int" | "address" | "addressList";

export function parseField(kind: FieldKind, raw: string): bigint | Address | Address[] {
  const value = raw.trim();
  if (value === "") throw new Error("missing value");
  switch (kind) {
    case "usdc":
      return parseUnits(value, USDC_DECIMALS);
    case "mon":
    case "shares":
    case "wad":
      return parseUnits(value, 18);
    case "int":
      return BigInt(value);
    case "address":
      if (!isAddress(value)) throw new Error("not an address");
      return value as Address;
    case "addressList": {
      const list = value.split(",").map((entry) => entry.trim());
      if (!list.every((entry) => isAddress(entry))) throw new Error("not an address");
      return list as Address[];
    }
  }
}

/** Signed USDC, for the perp mark. */
export function parseSignedUsdc(raw: string): bigint {
  const value = raw.trim();
  if (value === "") throw new Error("missing value");
  const negative = value.startsWith("-");
  const magnitude = parseUnits(negative ? value.slice(1) : value, USDC_DECIMALS);
  return negative ? -magnitude : magnitude;
}
