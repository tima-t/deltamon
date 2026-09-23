"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import { createPublicClient, erc20Abi, formatUnits, http, isAddress, parseUnits, type Address } from "viem";
import { ADDRESSES } from "@deltamon/shared";
import { sourceChainById } from "@/lib/crosschain/chains";
import type { FundedAsset } from "@/lib/crosschain/catalog";
import { depositErrorMessage, isTerminalDeposit, parseStoredSession, quoteExpired, RECENT_SESSION_KEY, SESSION_KEY, type DepositSession } from "@/lib/crosschain/session";
import { DepositJourney } from "./DepositJourney";

interface Execution {
  id?: string;
  status?: string;
  quote?: {
    minAmountOut?: string;
    amountOut?: string;
    amountIn?: string;
    depositAddress?: string;
    deadline?: string;
  };
  details?: {
    networkFee?: string;
    serviceFee?: string;
    messageSigned?: boolean;
    payload?: { payload_json?: string; standard?: string };
  };
  destinationChainTxHashes?: string[];
  originChainTxHashes?: string[];
}

interface QuoteResponse {
  execution: Execution;
  source: FundedAsset;
  minShares: string;
  depositAmount: string;
  reusedUsdc: string;
  startingBlock?: string;
  initialShares?: string;
}

type Session = DepositSession;

interface StatusResponse {
  execution: Execution;
  intermediaryBalance: string | null;
  shares: string | null;
  mintTxHash?: string | null;
}

async function json<T>(url: string, body?: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
  const response = await fetch(url, {
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function restoreSession(key: string, account: Address): Session | null {
  try {
    return parseStoredSession(localStorage.getItem(key), account);
  } catch {
    return null;
  }
}

function saveSession(value: Session | null, key = SESSION_KEY) {
  if (value) localStorage.setItem(key, JSON.stringify(value));
  else localStorage.removeItem(key);
}

function mintConfirmedFor(status: StatusResponse, session: Session): boolean {
  return Boolean(
    status.mintTxHash ||
    (status.execution.status === "SUCCESS" && status.shares && session.initialShares && BigInt(status.shares) > BigInt(session.initialShares)),
  );
}

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function stage(status?: string, sourceTxHash?: string, mintConfirmed?: boolean) {
  if (status === "SUCCESS") return mintConfirmed ? "Shares minted" : "Aurora settled; checking share mint";
  if (status === "OPERATION_FAILED") return "Vault deposit needs attention";
  if (status === "DEPOSIT_FAILED" || status === "EXPIRED") return "Transfer refunded or expired";
  if (status === "OPERATION_PROCESSING") return "Minting sdMON on Monad";
  if (status === "OPERATION_PENDING") return "USDC arrived on Monad";
  if (status === "DEPOSIT_PROCESSING") return "Routing USDC to Monad";
  if (status === "DEPOSIT_PENDING" || sourceTxHash) return "Source transfer sent";
  return "Ready for wallet confirmation";
}

export function CrossChainDepositPanel({ monadPanel }: { monadPanel: ReactNode }) {
  const { address, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const [assets, setAssets] = useState<FundedAsset[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const balanceRequest = useRef(0);
  const [selectedId, setSelectedId] = useState("");
  const [amountText, setAmountText] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [recentSession, setRecentSession] = useState<Session | null>(null);
  const restoredSessionId = useRef<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recoveryQuote, setRecoveryQuote] = useState<{ amount: string; fee: string } | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<Execution | null>(null);
  const { data: monadBalance, isLoading: loadingMonadBalance, refetch: refetchMonadBalance } = useReadContract({
    chainId: 143,
    address: ADDRESSES[143].tokens.USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const isMonadSelected = selectedId === "monad";
  const selected = assets.find((asset) => asset.assetId === selectedId);
  const amount = (() => {
    if (!selected || !/^\d+(\.\d+)?$/.test(amountText)) return 0n;
    try { return parseUnits(amountText, selected.decimals); } catch { return 0n; }
  })();
  const overBalance = selected?.balance !== null && selected?.balance !== undefined && amount > BigInt(selected.balance);
  const canQuote = Boolean(address && selected && amount > 0n && !overBalance && !busy && !session);

  const refreshBalances = useCallback(async (account: Address) => {
    const request = ++balanceRequest.current;
    setLoadingBalances(true);
    setError("");
    void refetchMonadBalance();
    try {
      const data = await json<{ assets: FundedAsset[] }>(`/api/crosschain/balances?address=${account}`, undefined, 15_000);
      if (request === balanceRequest.current) setAssets(data.assets.filter((asset) => asset.chainId !== 143));
    } catch (cause) {
      if (request === balanceRequest.current) {
        setError(cause instanceof Error && cause.name === "TimeoutError"
          ? "Balance check timed out. Refresh to try again."
          : cause instanceof Error ? cause.message : "Could not load USDC balances");
      }
    } finally {
      if (request === balanceRequest.current) setLoadingBalances(false);
    }
  }, [refetchMonadBalance]);

  useEffect(() => {
    if (!address) {
      balanceRequest.current += 1;
      return;
    }
    const timer = setTimeout(() => {
      setAssets([]);
      setSelectedId("");
      setAmountText("");
      setQuote(null);
      setStatus(null);
      const active = restoreSession(SESSION_KEY, address);
      const recent = restoreSession(RECENT_SESSION_KEY, address);
      if (active?.terminalStatus && !active.recoveryId) {
        saveSession(active, RECENT_SESSION_KEY);
        saveSession(null);
        setRecentSession(active);
        setSession(null);
        restoredSessionId.current = null;
      } else {
        setRecentSession(recent);
        setSession(active);
        restoredSessionId.current = active?.id ?? null;
      }
      void refreshBalances(address);
    }, 0);
    return () => clearTimeout(timer);
  }, [address, refreshBalances]);

  useEffect(() => {
    if (!address || !session || session.account.toLowerCase() !== address.toLowerCase()) return;
    let active = true;
    async function poll() {
      try {
        const data = await json<StatusResponse>(
          `/api/crosschain/status?account=${address}&id=${encodeURIComponent(session!.id)}${session!.startingBlock ? `&startBlock=${session!.startingBlock}` : ""}`,
        );
        if (!active) return;
        const executionStatus = data.execution.status;
        if (isTerminalDeposit(executionStatus, mintConfirmedFor(data, session!))) {
          const settled = { ...session!, terminalStatus: executionStatus };
          if (restoredSessionId.current === session!.id && !session!.recoveryId) {
            saveSession(settled, RECENT_SESSION_KEY);
            saveSession(null);
            restoredSessionId.current = null;
            setRecentSession(settled);
            setSession(null);
            setStatus(null);
            return;
          }
          if (!session!.recoveryId) saveSession(settled);
        }
        setStatus(data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not update deposit status");
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 8_000);
    return () => { active = false; clearInterval(timer); };
  }, [address, session]);

  useEffect(() => {
    if (!address || !session?.recoveryId) return;
    let active = true;
    const poll = async () => {
      try {
        const data = await json<StatusResponse>(`/api/crosschain/status?account=${address}&id=${encodeURIComponent(session.recoveryId!)}`);
        if (!active) return;
        setRecoveryStatus(data.execution);
        if (restoredSessionId.current === session.id && ["SUCCESS", "OPERATION_FAILED", "EXPIRED"].includes(data.execution.status ?? "")) {
          const settled: Session = { ...session, terminalStatus: session.terminalStatus ?? "OPERATION_FAILED" };
          saveSession(settled, RECENT_SESSION_KEY);
          saveSession(null);
          restoredSessionId.current = null;
          setRecentSession(settled);
          setSession(null);
          setStatus(null);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not update recovery status");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 8_000);
    return () => { active = false; clearInterval(timer); };
  }, [address, session]);

  async function review() {
    if (!address || !selected || !canQuote) return;
    setError("");
    setBusy(true);
    try {
      const result = await json<QuoteResponse>("/api/crosschain/execution", {
        mode: "quote", account: address, sourceAssetId: selected.assetId, amount: amount.toString(),
      });
      setQuote(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not get a quote");
    } finally {
      setBusy(false);
    }
  }

  async function authorizeAndSend(current: Session, execution: Execution) {
    if (!address || address.toLowerCase() !== current.account.toLowerCase()) return;
    const chain = sourceChainById(current.sourceChainId);
    if (!chain) throw new Error("The selected source chain is unavailable");
    if (quoteExpired(current.deadline, Date.now())) {
      throw new Error("This quote expired. Start a new deposit before sending USDC.");
    }
    if (!current.sourceTxHash) {
      if (!execution.details?.messageSigned) {
        if (!execution.details?.payload?.payload_json) throw new Error("Aurora signing payload unavailable");
        if (execution.details.payload.standard !== "erc191") throw new Error("Unsupported wallet signature type");
        const signature = await signMessageAsync({ message: execution.details.payload.payload_json });
        await json("/api/crosschain/signature", { account: address, id: current.id, signature });
      }
      if (chainId !== current.sourceChainId) await switchChainAsync({ chainId: current.sourceChainId });
      const txHash = await writeContractAsync({
        address: current.sourceToken,
        abi: erc20Abi,
        functionName: "transfer",
        args: [current.depositAddress, BigInt(current.amount)],
        chainId: current.sourceChainId,
      });
      const next = { ...current, sourceTxHash: txHash };
      saveSession(next);
      setSession(next);
      const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") {
        const retry = { ...current, sourceTxHash: undefined };
        saveSession(retry);
        setSession(retry);
        throw new Error("The USDC transfer reverted on the source chain. You can retry before the quote expires.");
      }
      await json("/api/crosschain/source", { depositAddress: current.depositAddress, txHash });
      void refreshBalances(address);
    }
  }

  async function start() {
    if (!address || !selected || !quote || busy) return;
    if (quoteExpired(quote.execution.quote?.deadline, Date.now())) {
      setQuote(null);
      setError("This quote expired. Review a new quote before depositing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fresh = await json<QuoteResponse>("/api/crosschain/execution", {
        mode: "create",
        account: address,
        sourceAssetId: selected.assetId,
        amount: amount.toString(),
        minAcceptedOutput: quote.depositAmount,
        expectedIntermediaryBalance: quote.reusedUsdc,
      });
      const execution = fresh.execution;
      const depositAddress = execution.quote?.depositAddress;
      if (!execution.id || !depositAddress || !isAddress(depositAddress)) {
        throw new Error("Aurora did not provide an EVM deposit address");
      }
      const current: Session = {
        account: address,
        id: execution.id,
        sourceAssetId: selected.assetId,
        sourceChainId: selected.chainId,
        sourceToken: selected.contractAddress,
        sourceName: selected.chainName,
        amount: amount.toString(),
        sourceDecimals: selected.decimals,
        depositAddress,
        deadline: execution.quote?.deadline,
        startingBlock: fresh.startingBlock,
        initialShares: fresh.initialShares,
      };
      saveSession(current);
      setSession(current);
      setStatus({ execution, intermediaryBalance: null, shares: null });
      await authorizeAndSend(current, execution);
    } catch (cause) {
      setError(depositErrorMessage(cause, selected.chainName));
    } finally {
      setBusy(false);
    }
  }

  async function continueDeposit() {
    if (!address || !session || !status || busy) return;
    setBusy(true);
    setError("");
    try {
      if (session.sourceTxHash) {
        const chain = sourceChainById(session.sourceChainId);
        if (!chain) throw new Error("The source chain is unavailable");
        const client = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
        const receipt = await client.waitForTransactionReceipt({ hash: session.sourceTxHash });
        if (receipt.status !== "success") {
          const retry = { ...session, sourceTxHash: undefined };
          saveSession(retry);
          setSession(retry);
          throw new Error("The source USDC transfer reverted. You can retry before the quote expires.");
        }
        await json("/api/crosschain/source", {
          depositAddress: session.depositAddress, txHash: session.sourceTxHash,
        });
      } else {
        await authorizeAndSend(session, status.execution);
      }
    } catch (cause) {
      setError(depositErrorMessage(cause, session.sourceName));
    } finally {
      setBusy(false);
    }
  }

  async function reviewRecovery() {
    if (!address || !session) return;
    setBusy(true);
    setError("");
    try {
      const result = await json<{ amount: string; fee: string }>("/api/crosschain/recovery", {
        mode: "quote", account: address, id: session.id,
      });
      setRecoveryQuote(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not quote recovery");
    } finally { setBusy(false); }
  }

  async function startRecovery() {
    if (!address || !session || !recoveryQuote) return;
    setBusy(true);
    setError("");
    try {
      const result = await json<{ execution: Execution; amount: string }>("/api/crosschain/recovery", {
        mode: "create", account: address, id: session.id, minAcceptedAmount: recoveryQuote.amount,
      });
      const execution = result.execution;
      if (!execution.id || !execution.details?.payload?.payload_json || execution.details.payload.standard !== "erc191") {
        throw new Error("Aurora did not return a recovery signing payload");
      }
      const updated = { ...session, recoveryId: execution.id };
      saveSession(updated);
      setSession(updated);
      const signature = await signMessageAsync({ message: execution.details.payload.payload_json });
      await json("/api/crosschain/signature", { account: address, id: execution.id, signature });
      setRecoveryStatus(execution);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start recovery");
    } finally { setBusy(false); }
  }

  async function resumeRecovery() {
    if (!address || !session?.recoveryId || !recoveryStatus?.details?.payload?.payload_json) return;
    setBusy(true);
    setError("");
    try {
      if (recoveryStatus.details.payload.standard !== "erc191") throw new Error("Unsupported recovery signature type");
      const signature = await signMessageAsync({ message: recoveryStatus.details.payload.payload_json });
      await json("/api/crosschain/signature", { account: address, id: session.recoveryId, signature });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not authorize recovery");
    } finally { setBusy(false); }
  }

  function clearSession() {
    if (session && status && isTerminalDeposit(status.execution.status, mintConfirmedFor(status, session))) {
      const settled = { ...session, terminalStatus: status.execution.status };
      saveSession(settled, RECENT_SESSION_KEY);
      setRecentSession(settled);
    }
    saveSession(null);
    restoredSessionId.current = null;
    setSession(null);
    setStatus(null);
    setQuote(null);
    setError("");
    if (address) void refreshBalances(address);
  }

  const mintConfirmed = Boolean(status && session && mintConfirmedFor(status, session));

  return (
    <div className="space-y-4">
      {!address ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Choose a source</h3>
            <p className="text-muted mt-1 text-sm">Connect your wallet to find your USDC and choose an amount.</p>
          </div>
          <button type="button" onClick={() => openConnectModal?.()} className="bg-monad hover:bg-monad-deep w-full rounded-lg px-4 py-3 font-medium text-white transition-[background-color,scale] active:scale-[0.96]">
            Connect wallet
          </button>
        </div>
      ) : session ? (
        <div className="border-line bg-paper/40 space-y-4 rounded-xl border p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-muted text-xs font-semibold uppercase tracking-[0.16em]">{mintConfirmed ? "Deposit complete" : ["OPERATION_FAILED", "DEPOSIT_FAILED", "EXPIRED"].includes(status?.execution.status ?? "") ? "Deposit needs attention" : "Deposit in progress"}</p>
              <p role="status" aria-live="polite" className="mt-1 text-lg font-semibold text-balance">{stage(status?.execution.status, session.sourceTxHash, mintConfirmed)}</p>
            </div>
            <span className="text-muted shrink-0 rounded-full border border-line px-2.5 py-1 font-mono text-[11px]">{short(session.account)}</span>
          </div>
          <DepositJourney status={status?.execution.status} sourceName={session.sourceName} sourceTxSent={Boolean(session.sourceTxHash)} mintConfirmed={mintConfirmed} />
          <p className="text-muted flex items-center gap-2 text-xs">
            {!mintConfirmed && !["OPERATION_FAILED", "DEPOSIT_FAILED", "EXPIRED"].includes(status?.execution.status ?? "") ? <span aria-hidden="true" className="deposit-live-dot bg-long inline-block size-1.5 rounded-full" /> : null}
            {mintConfirmed ? "sdMON arrived" : "Status updates automatically"}. Shares go to {short(session.account)} on Monad.
          </p>
          <div className="border-line grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-4 text-sm">
            <span className="text-muted">Source amount</span>
            <span className="text-right tabular-nums">{formatUnits(BigInt(session.amount), session.sourceDecimals ?? 6)} USDC</span>
            <span className="text-muted">Funding address · {session.sourceName} USDC</span>
            <span className="truncate text-right font-mono text-xs" title={session.depositAddress}>{short(session.depositAddress)}</span>
            {session.sourceTxHash ? <><span className="text-muted">Source transaction</span><a className="text-monad text-right font-mono text-xs underline" href={`${sourceChainById(session.sourceChainId)?.blockExplorers?.default.url}/tx/${session.sourceTxHash}`} target="_blank" rel="noreferrer">{short(session.sourceTxHash)}</a></> : null}
            {status?.execution.destinationChainTxHashes?.[0] ? <><span className="text-muted">Monad transaction</span><a className="text-monad text-right font-mono text-xs underline" href={`https://monadvision.com/tx/${status.execution.destinationChainTxHashes[0]}`} target="_blank" rel="noreferrer">{short(status.execution.destinationChainTxHashes[0])}</a></> : null}
            {status?.mintTxHash ? <><span className="text-muted">Monad mint transaction</span><a className="text-monad text-right font-mono text-xs underline" href={`https://monadvision.com/tx/${status.mintTxHash}`} target="_blank" rel="noreferrer">{short(status.mintTxHash)}</a></> : null}
          </div>
          <p className="text-muted text-xs leading-5 text-pretty">
            The funding address is supplied by Aurora for this {session.sourceName} USDC route. It is separate from your wallet, the vault, and your Monad intermediary account. Send only USDC on {session.sourceName} for this quote; do not reuse the address for another deposit.
          </p>
          {status?.execution.status === "SUCCESS" ? (
            <p className={mintConfirmed ? "text-long text-sm" : "text-muted text-sm"}>{status.mintTxHash ? "Vault Deposit event confirmed." : mintConfirmed ? "sdMON balance increased." : "Aurora reports success. Checking the vault mint."} {status.shares ? `Your wallet holds ${Number(formatUnits(BigInt(status.shares), 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} sdMON.` : ""}</p>
          ) : null}
          {status?.execution.status === "OPERATION_FAILED" ? (
            <p className="text-short text-sm">USDC reached Monad, but the vault call failed. {status.intermediaryBalance ? `${formatUnits(BigInt(status.intermediaryBalance), 6)} USDC remains in your Aurora intermediary account.` : "Check the intermediary account before retrying."}</p>
          ) : null}
          {status?.intermediaryBalance && BigInt(status.intermediaryBalance) > 0n ? (
            <div className="border-line space-y-2 border-t pt-3 text-sm">
              <p>{formatUnits(BigInt(status.intermediaryBalance), 6)} USDC remains in your wallet-controlled Aurora intermediary account on Monad.</p>
              <p className="text-muted text-xs leading-5">{status.execution.status === "SUCCESS"
                ? "A route can deliver more than its quoted minimum, and this balance may include earlier leftovers. It will be included automatically in your next deposit from another chain. You can also withdraw it now for an execution fee."
                : "The vault call did not use this USDC. You can authorize a transfer back to your wallet on Monad."}</p>
              {session.recoveryId ? (
                <>
                  <p className={recoveryStatus?.status === "SUCCESS" ? "text-long" : "text-muted"}>Recovery: {recoveryStatus?.status === "SUCCESS" ? "USDC returned to your connected address on Monad." : (recoveryStatus?.status ?? "waiting for status")}</p>
                  {recoveryStatus?.details?.messageSigned === false && recoveryStatus.details.payload?.payload_json ? <button type="button" disabled={busy} onClick={() => void resumeRecovery()} className="border-line w-full rounded-lg border px-3 py-2 font-medium disabled:opacity-50">Sign recovery authorization</button> : null}
                  {["SUCCESS", "OPERATION_FAILED", "EXPIRED"].includes(recoveryStatus?.status ?? "") ? <button type="button" onClick={() => { const retry = { ...session, recoveryId: undefined }; saveSession(retry); setSession(retry); setRecoveryStatus(null); setRecoveryQuote(null); }} className="border-line w-full rounded-lg border px-3 py-2 font-medium">Review remaining USDC</button> : null}
                </>
              ) : recoveryQuote ? (
                <>
                  <p className="text-muted">Recover about {formatUnits(BigInt(recoveryQuote.amount), 6)} USDC to {short(session.account)} on Monad. Estimated execution fee: {formatUnits(BigInt(recoveryQuote.fee), 6)} USDC.</p>
                  <button type="button" disabled={busy} onClick={() => void startRecovery()} className="bg-monad w-full rounded-lg px-3 py-2 font-medium text-white disabled:opacity-50">Authorize recovery</button>
                </>
              ) : (
                <button type="button" disabled={busy} onClick={() => void reviewRecovery()} className="border-line w-full rounded-lg border px-3 py-2 font-medium disabled:opacity-50">{status.execution.status === "SUCCESS" ? "Review withdrawal instead" : "Review USDC recovery"}</button>
              )}
            </div>
          ) : null}
          {status?.execution.status === "EXPIRED" || status?.execution.status === "DEPOSIT_FAILED" ? (
            <p className="text-short text-sm">Aurora reports this transfer as expired or failed. Check its refund status before starting another deposit.</p>
          ) : null}
          {!session.sourceTxHash && !["SUCCESS", "EXPIRED", "DEPOSIT_FAILED", "OPERATION_FAILED"].includes(status?.execution.status ?? "") ? (
            <button type="button" disabled={busy || !status} onClick={() => void continueDeposit()} className="bg-monad hover:bg-monad-deep w-full rounded-lg px-4 py-2.5 font-medium text-white disabled:opacity-50">
              {busy ? "Waiting for wallet…" : "Continue in wallet"}
            </button>
          ) : null}
          {session.sourceTxHash && status?.execution.status !== "SUCCESS" ? (
            <button type="button" disabled={busy} onClick={() => void continueDeposit()} className="border-line w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-50">
              Refresh source transaction tracking
            </button>
          ) : null}
          {["SUCCESS", "EXPIRED", "DEPOSIT_FAILED", "OPERATION_FAILED"].includes(status?.execution.status ?? "") &&
            (!session.recoveryId || ["SUCCESS", "OPERATION_FAILED", "EXPIRED"].includes(recoveryStatus?.status ?? "")) ? (
            <button type="button" onClick={clearSession} className="text-muted text-sm underline">Start another deposit</button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Choose a source</h3>
                <p className="text-muted mt-0.5 text-xs">Choose where your USDC is held.</p>
              </div>
              <button type="button" disabled={loadingBalances} onClick={() => void refreshBalances(address)} className="text-monad hover:text-monad-deep min-h-10 px-2 text-xs font-medium disabled:opacity-50">Refresh</button>
            </div>
            {recentSession ? (
              <div className="border-line bg-paper/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs">
                <p className="text-muted">{recentSession.terminalStatus === "SUCCESS" ? "Last deposit completed." : "Previous deposit needs attention."}</p>
                <button type="button" onClick={() => { restoredSessionId.current = null; setStatus(null); setSession(recentSession); }} className="text-monad shrink-0 font-medium underline">View details</button>
              </div>
            ) : null}
            <div className="grid gap-2" role="group" aria-label="Choose USDC source">
              {monadBalance !== undefined && monadBalance > 0n ? (
                <button type="button" aria-pressed={isMonadSelected} onClick={() => { setSelectedId("monad"); setAmountText(""); setQuote(null); }} className={`border-line flex min-h-15 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color,scale] active:scale-[0.96] ${isMonadSelected ? "border-monad bg-monad/10" : "hover:border-monad/50"}`}>
                  <span aria-hidden="true" className="bg-monad/15 text-monad flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold">M</span>
                  <span className="min-w-0 flex-1 text-sm font-medium">Monad</span>
                  <span className="text-right text-sm font-semibold tabular-nums">{Number(formatUnits(monadBalance, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-muted text-xs font-normal">USDC</span></span>
                </button>
              ) : null}
              {assets.map((asset) => (
                <button key={asset.assetId} type="button" disabled={asset.balance === null} aria-pressed={selectedId === asset.assetId} onClick={() => { setSelectedId(asset.assetId); setAmountText(""); setQuote(null); }} className={`border-line flex min-h-15 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color,scale] active:scale-[0.96] ${selectedId === asset.assetId ? "border-monad bg-monad/10" : "hover:border-monad/50"} disabled:opacity-50`}>
                  <span aria-hidden="true" className="bg-paper text-muted flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold">{asset.chainName.slice(0, 1)}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{asset.chainName}</span>
                  <span className="text-right text-sm font-semibold tabular-nums">{asset.balance === null ? asset.error : `${Number(formatUnits(BigInt(asset.balance), asset.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}</span>
                </button>
              ))}
              {!loadingBalances && !loadingMonadBalance && assets.length === 0 && (!monadBalance || monadBalance === 0n) ? <p className="text-muted py-3 text-sm">No USDC balances found on supported chains.</p> : null}
              {loadingBalances || loadingMonadBalance ? <p className="text-muted py-2 text-xs">Checking USDC balances…</p> : null}
            </div>
          </div>
          {isMonadSelected ? <div className="border-line border-t pt-4">{monadPanel}</div> : null}
          {selected ? (
            <label className="block">
              <span className="text-muted text-sm">Amount from {selected.chainName}</span>
              <div className="border-line mt-1 flex items-center rounded-lg border px-3">
                <input inputMode="decimal" value={amountText} onChange={(event) => { setAmountText(event.target.value.replace(/[^0-9.]/g, "")); setQuote(null); }} placeholder="0.00" className="w-full bg-transparent py-3 text-2xl tabular-nums outline-none" />
                <button type="button" onClick={() => { setAmountText(formatUnits(BigInt(selected.balance ?? "0"), selected.decimals)); setQuote(null); }} className="text-monad pr-2 text-xs font-semibold">MAX</button>
                <span className="text-muted text-sm">USDC</span>
              </div>
            </label>
          ) : null}
          {overBalance ? <p className="text-short text-sm">Amount exceeds your balance.</p> : null}
          {selected && !quote ? (
            <button type="button" disabled={!canQuote} onClick={() => void review()} className="bg-monad hover:bg-monad-deep w-full rounded-lg px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Getting quote…" : "Review deposit"}
            </button>
          ) : null}
          {quote ? (
            <div className="border-monad/40 bg-monad/5 space-y-2 rounded-lg border p-4 text-sm">
              <p className="font-semibold">Review your deposit</p>
              <p className="text-muted">Send {amountText} USDC on {selected?.chainName}. The vault will receive {formatUnits(BigInt(quote.depositAmount), 6)} USDC on Monad.</p>
              {BigInt(quote.reusedUsdc) > 0n ? <p className="text-muted">This includes {formatUnits(BigInt(quote.reusedUsdc), 6)} USDC already in your Monad intermediary account. It will join this deposit in the same wallet-authorized vault call.</p> : null}
              <p className="text-muted">About {Number(formatUnits(BigInt(quote.minShares), 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} sdMON goes to {short(address)} on Monad. The vault share price may change before settlement.</p>
              {quote.execution.details?.networkFee ? <p className="text-muted">Estimated Monad execution fee: {formatUnits(BigInt(quote.execution.details.networkFee), 6)} USDC, already accounted for in Aurora’s minimum output.</p> : null}
              {quote.execution.quote?.deadline ? <p className="text-muted">Quote expires {new Date(quote.execution.quote.deadline).toLocaleString()}.</p> : null}
              <p className="text-muted">You will sign an authorization and send USDC on {selected?.chainName}. Source-chain gas is required; no Monad gas is needed.</p>
              <button type="button" disabled={busy} onClick={() => void start()} className="bg-monad hover:bg-monad-deep w-full rounded-lg px-4 py-3 font-medium text-white disabled:opacity-50">
                {busy ? "Preparing wallet…" : "Confirm and deposit"}
              </button>
            </div>
          ) : null}
        </>
      )}
      {error ? <p role="alert" className="text-short text-sm">{error}</p> : null}
    </div>
  );
}
