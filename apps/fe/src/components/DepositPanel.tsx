"use client";

import { useEffect, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { formatUnits, parseUnits, type Address } from "viem";
import {
  useAccount,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ADDRESSES, deltaMonVaultAbi, erc20Abi, getDeployment } from "@deltamon/shared";
import { describeRevert } from "@/lib/revert";
import { CrossChainDepositPanel } from "./CrossChainDepositPanel";

const USDC_DECIMALS = 6;

function parsedAmount(input: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(input)) return 0n;
  try {
    return parseUnits(input, USDC_DECIMALS);
  } catch {
    return 0n;
  }
}

function useVaultAddress(): Address | undefined {
  const fromEnv = process.env.NEXT_PUBLIC_VAULT_ADDRESS as Address | undefined;
  if (fromEnv && fromEnv.length === 42) return fromEnv;
  return getDeployment(143)?.vault;
}

function MonadDepositPanel({ embedded = false }: { embedded?: boolean }) {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync, isPending: switchingNetwork } = useSwitchChain();
  const usdc = ADDRESSES[143].tokens.USDC as Address;
  const vault = useVaultAddress();
  const [input, setInput] = useState("");
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [lastAction, setLastAction] = useState<"approve" | "deposit" | "redeem" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const lastRefreshedHash = useRef<string | null>(null);

  const enabled = Boolean(usdc && address);
  const { data: balance, refetch: refetchBalance } = useReadContract({
    chainId: 143,
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    chainId: 143,
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && vault ? [address, vault] : undefined,
    query: { enabled: enabled && Boolean(vault) },
  });
  const { data: shares, refetch: refetchShares } = useReadContract({
    chainId: 143,
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(vault && address) },
  });
  const { data: shareDecimals } = useReadContract({
    chainId: 143,
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "decimals",
    query: { enabled: Boolean(vault) },
  });
  const { data: minDeposit } = useReadContract({
    chainId: 143,
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "minDeposit",
    query: { enabled: Boolean(vault) },
  });
  const { data: previewShares } = useReadContract({
    chainId: 143,
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "previewDeposit",
    args: [parsedAmount(input)],
    query: { enabled: Boolean(vault) && input !== "" },
  });

  const { writeContractAsync, isPending, error, reset } = useWriteContract();
  const {
    isLoading: confirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    chainId: 143,
    hash,
    query: { enabled: Boolean(hash) },
  });

  const amount = parsedAmount(input);
  const needsApproval = allowance !== undefined && amount > allowance;
  const overBalance = balance !== undefined && amount > balance;
  const belowMin = minDeposit !== undefined && amount > 0n && amount < minDeposit;
  const busy = preparing || switchingNetwork || isPending || confirming;
  const canSubmit = isConnected && vault && amount > 0n && !overBalance && !belowMin && !busy;
  const decimals = shareDecimals ?? 18;

  useEffect(() => {
    if (!isSuccess || !hash || lastRefreshedHash.current === hash) return;
    lastRefreshedHash.current = hash;
    void Promise.all([refetchBalance(), refetchAllowance(), refetchShares()]);
  }, [isSuccess, hash, refetchBalance, refetchAllowance, refetchShares]);

  async function submit() {
    if (!vault || !usdc || !address) return;
    setActionError(null);
    setHash(undefined);
    reset();
    setPreparing(true);
    try {
      if (chainId !== 143) await switchChainAsync({ chainId: 143 });
      if (needsApproval) {
        setLastAction("approve");
        setHash(
          await writeContractAsync({
            address: usdc,
            chainId: 143,
            abi: erc20Abi,
            functionName: "approve",
            args: [vault, amount],
          }),
        );
        return;
      }
      setLastAction("deposit");
      setHash(
        await writeContractAsync({
          address: vault,
          chainId: 143,
          abi: deltaMonVaultAbi,
          functionName: "deposit",
          args: [amount, address],
        }),
      );
      setInput("");
    } catch (cause) {
      setActionError(describeRevert(cause));
    } finally {
      setPreparing(false);
    }
  }

  async function redeemAll() {
    if (!vault || !address || !shares) return;
    setActionError(null);
    setHash(undefined);
    reset();
    setPreparing(true);
    try {
      if (chainId !== 143) await switchChainAsync({ chainId: 143 });
      setLastAction("redeem");
      setHash(
        await writeContractAsync({
          address: vault,
          chainId: 143,
          abi: deltaMonVaultAbi,
          functionName: "redeem",
          args: [shares, address, address],
        }),
      );
    } catch (cause) {
      setActionError(describeRevert(cause));
    } finally {
      setPreparing(false);
    }
  }

  const label = !isConnected
    ? "Connect a wallet to deposit"
    : !vault
      ? "Vault not deployed on this network yet"
      : needsApproval
        ? "Approve USDC"
        : "Deposit USDC";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        {embedded ? (
          <span className="text-muted text-sm">Amount from Monad</span>
        ) : (
          <h2 className="text-xl font-semibold">Deposit</h2>
        )}
        {balance !== undefined ? (
          <button
            type="button"
            className="text-muted hover:text-ink text-sm underline-offset-2 hover:underline"
            onClick={() => setInput(formatUnits(balance, USDC_DECIMALS))}
          >
            Balance {Number(formatUnits(balance, USDC_DECIMALS)).toLocaleString()} USDC
          </button>
        ) : null}
      </div>

      <label className="mt-4 block">
        {!embedded ? <span className="text-muted text-sm">Amount</span> : null}
        <div className="border-line focus-within:border-monad mt-1 flex items-center rounded-lg border px-3">
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-full bg-transparent py-3 text-2xl tabular-nums outline-none"
          />
          <span className="text-muted pl-2 text-sm">USDC</span>
        </div>
      </label>
      {overBalance ? (
        <p className="text-short mt-2 text-sm">That is more than your balance.</p>
      ) : null}
      {belowMin && minDeposit !== undefined ? (
        <p className="text-short mt-2 text-sm">
          Minimum deposit is {formatUnits(minDeposit, USDC_DECIMALS)} USDC.
        </p>
      ) : null}
      {previewShares !== undefined && amount > 0n && !belowMin ? (
        <p className="text-muted mt-2 text-sm tabular-nums">
          You receive about{" "}
          {Number(formatUnits(previewShares, decimals)).toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}{" "}
          sdMON, your share of everything the vault holds.
        </p>
      ) : null}

      <button
        type="button"
        disabled={isConnected && !canSubmit}
        onClick={() => (!isConnected ? openConnectModal?.() : void submit())}
        className="bg-monad hover:bg-monad-deep mt-4 w-full rounded-lg px-4 py-3 text-base font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {switchingNetwork
          ? "Switching to Monad…"
          : preparing
            ? "Preparing wallet…"
            : isPending
              ? "Confirm in wallet…"
              : confirming
                ? "Confirming…"
                : label}
      </button>

      {isConnected && chainId !== 143 ? (
        <p className="text-muted mt-2 text-xs">Your wallet will switch to Monad first.</p>
      ) : null}

      {isSuccess && hash ? (
        <p className="text-long mt-3 text-sm">
          {lastAction === "approve"
            ? "Approved. You can deposit now."
            : lastAction === "redeem"
              ? "Redeemed. USDC is back in your wallet."
              : "Deposited. sdMON is in your wallet."}
        </p>
      ) : null}
      {actionError || error || receiptError ? (
        <p className="text-short mt-3 text-sm">
          {actionError ?? describeRevert(receiptError ?? error)}
        </p>
      ) : null}

      <p className="text-muted mt-4 text-sm">
        Redeem for USDC whenever the vault holds enough idle cash. When it does not, queue a
        redemption in the console and the admin has 36 hours to fund it.
      </p>

      {shares !== undefined && shares > 0n ? (
        <div className="border-line mt-4 flex items-center justify-between border-t pt-4 text-sm">
          <span className="tabular-nums">
            You hold{" "}
            {Number(formatUnits(shares, decimals)).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}{" "}
            sdMON
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void redeemAll()}
            className="border-line hover:border-ink rounded-md border px-3 py-1.5 font-medium transition-colors disabled:opacity-50"
          >
            Redeem all for USDC
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DepositPanel() {
  const [crossChainEnabled, setCrossChainEnabled] = useState(false);

  useEffect(() => {
    void fetch("/api/crosschain/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config: { enabled?: boolean }) => setCrossChainEnabled(config.enabled === true))
      .catch(() => setCrossChainEnabled(false));
  }, []);

  return (
    <div id="deposit" className="border-line bg-surface rounded-xl border p-5">
      {crossChainEnabled ? (
        <CrossChainDepositPanel monadPanel={<MonadDepositPanel embedded />} />
      ) : (
        <MonadDepositPanel />
      )}
    </div>
  );
}
