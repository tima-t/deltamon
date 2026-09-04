"use client";

import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import {
  ADDRESSES,
  deltaVaultAbi,
  erc20Abi,
  getDeployment,
  isSupportedChainId,
} from "@deltamon/shared";

const DECIMALS = 6;

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

  const { data: balance } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(usdc && address) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && vault ? [address, vault] : undefined,
    query: { enabled: Boolean(usdc && address && vault) },
  });

  const { data: shares } = useReadContract({
    address: vault,
    abi: deltaVaultAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(vault && address) },
  });

  const { writeContractAsync, isPending, error } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const amount = input && !Number.isNaN(Number(input)) ? parseUnits(input, DECIMALS) : 0n;
  const needsApproval = allowance !== undefined && amount > allowance;
  const overBalance = balance !== undefined && amount > balance;
  const canSubmit =
    isConnected && supported && vault && amount > 0n && !overBalance && !isPending && !confirming;

  async function submit() {
    if (!vault || !usdc || !address) return;
    if (needsApproval) {
      const tx = await writeContractAsync({
        address: usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [vault, amount],
      });
      setHash(tx);
      await refetchAllowance();
      return;
    }
    const tx = await writeContractAsync({
      address: vault,
      abi: deltaVaultAbi,
      functionName: "deposit",
      args: [amount, address],
    });
    setHash(tx);
    setInput("");
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
            onClick={() => setInput(formatUnits(balance, DECIMALS))}
          >
            Balance {Number(formatUnits(balance, DECIMALS)).toLocaleString()} USDC
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
          Confirmed. {needsApproval ? "You can deposit now." : "Shares are in your wallet."}
        </p>
      ) : null}
      {error ? <p className="text-short mt-3 text-sm">{error.message.split("\n")[0]}</p> : null}

      <p className="text-muted mt-4 text-sm">
        You receive dmUSDC shares. Withdraw any time; the vault unwinds both legs for you.
        {shares !== undefined && shares > 0n
          ? ` You hold ${Number(formatUnits(shares, DECIMALS)).toLocaleString()} dmUSDC.`
          : ""}
      </p>
    </div>
  );
}
