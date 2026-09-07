"use client";

import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  ADDRESSES,
  sdMonVaultAbi,
  erc20Abi,
  getDeployment,
  isSupportedChainId,
} from "@deltamon/shared";

const USDC_DECIMALS = 6;

function useVaultAddress(chainId: number | undefined): Address | undefined {
  const fromEnv = process.env.NEXT_PUBLIC_VAULT_ADDRESS as Address | undefined;
  if (fromEnv && fromEnv.length === 42) return fromEnv;
  return chainId ? getDeployment(chainId)?.vault : undefined;
}

export function DepositPanel() {
  const { address, chainId, isConnected } = useAccount();
  const supported = chainId !== undefined && isSupportedChainId(chainId);
  const usdc = supported ? (ADDRESSES[chainId].tokens.USDC as Address) : undefined;
  const vault = useVaultAddress(chainId);
  const [input, setInput] = useState("");
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [lastAction, setLastAction] = useState<"approve" | "deposit" | "redeem" | null>(null);

  const enabled = Boolean(usdc && address);
  const { data: balance, refetch: refetchBalance } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && vault ? [address, vault] : undefined,
    query: { enabled: enabled && Boolean(vault) },
  });
  const { data: shares, refetch: refetchShares } = useReadContract({
    address: vault,
    abi: sdMonVaultAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(vault && address) },
  });
  const { data: shareDecimals } = useReadContract({
    address: vault,
    abi: sdMonVaultAbi,
    functionName: "decimals",
    query: { enabled: Boolean(vault) },
  });
  const { data: minDeposit } = useReadContract({
    address: vault,
    abi: sdMonVaultAbi,
    functionName: "minDeposit",
    query: { enabled: Boolean(vault) },
  });
  const { data: previewShares } = useReadContract({
    address: vault,
    abi: sdMonVaultAbi,
    functionName: "previewDeposit",
    args: [input && !Number.isNaN(Number(input)) ? parseUnits(input, USDC_DECIMALS) : 0n],
    query: { enabled: Boolean(vault) && input !== "" },
  });

  const { writeContractAsync, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  const amount = input && !Number.isNaN(Number(input)) ? parseUnits(input, USDC_DECIMALS) : 0n;
  const needsApproval = allowance !== undefined && amount > allowance;
  const overBalance = balance !== undefined && amount > balance;
  const belowMin = minDeposit !== undefined && amount > 0n && amount < minDeposit;
  const busy = isPending || confirming;
  const canSubmit =
    isConnected && supported && vault && amount > 0n && !overBalance && !belowMin && !busy;
  const decimals = shareDecimals ?? 18;

  async function refresh() {
    await Promise.all([refetchBalance(), refetchAllowance(), refetchShares()]);
  }

  async function submit() {
    if (!vault || !usdc || !address) return;
    if (needsApproval) {
      setLastAction("approve");
      setHash(
        await writeContractAsync({
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, amount],
        }),
      );
      await refetchAllowance();
      return;
    }
    setLastAction("deposit");
    setHash(
      await writeContractAsync({
        address: vault,
        abi: sdMonVaultAbi,
        functionName: "deposit",
        args: [amount, address],
      }),
    );
    setInput("");
    await refresh();
  }

  async function redeemAll() {
    if (!vault || !address || !shares) return;
    setLastAction("redeem");
    setHash(
      await writeContractAsync({
        address: vault,
        abi: sdMonVaultAbi,
        functionName: "redeem",
        args: [shares, address, address],
      }),
    );
    await refresh();
  }

  const label = !isConnected
    ? "Connect a wallet to deposit"
    : !supported
      ? "Switch to Monad"
      : !vault
        ? "Vault not deployed on this network yet"
        : needsApproval
          ? "Approve USDC"
          : "Deposit USDC";

  return (
    <div id="deposit" className="border-line bg-surface rounded-xl border p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">Deposit</h2>
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
        <span className="text-muted text-sm">Amount</span>
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
          sdMON. 60% of the deposit is swapped into MON on Kuru.
        </p>
      ) : null}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void submit()}
        className="bg-monad hover:bg-monad-deep mt-4 w-full rounded-lg px-4 py-3 text-base font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Confirm in wallet…" : confirming ? "Confirming…" : label}
      </button>

      {isSuccess && hash ? (
        <p className="text-long mt-3 text-sm">
          {lastAction === "approve"
            ? "Approved. You can deposit now."
            : lastAction === "redeem"
              ? "Redeemed. USDC is back in your wallet."
              : "Deposited. sdMON is in your wallet."}
        </p>
      ) : null}
      {error ? <p className="text-short mt-3 text-sm">{error.message.split("\n")[0]}</p> : null}

      <p className="text-muted mt-4 text-sm">
        sdMON is your share of everything the vault holds. Redeem any time for USDC, or take USDC
        and MON out in kind.
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
