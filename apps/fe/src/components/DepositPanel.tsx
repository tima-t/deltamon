"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import {
  useAccount,
  useBalance,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  ADDRESSES,
  deltaMonVaultAbi,
  erc20Abi,
  getDeployment,
  monadMainnet,
} from "@deltamon/shared";
import { describeRevert } from "@/lib/revert";
import { assertContractGas } from "@/lib/nativeGas";
import { showReturnRouteAfterDeposit } from "@/lib/depositConfirmation";
import { CrossChainDepositPanel } from "./CrossChainDepositPanel";
import { ReceiveFunds } from "./ReceiveFunds";
import { useWalletEntry } from "./WalletEntry";
import { DepositStepIndicator, type DepositStep } from "./DepositStepIndicator";

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

type DepositScreen = DepositStep | "fund" | "result" | "error";

function MonadDepositPanel({
  embedded = false,
  onStageChange,
}: {
  embedded?: boolean;
  onStageChange?: (stage: DepositScreen) => void;
}) {
  const { address, chainId, isConnected } = useAccount();
  const { openEntry, isPasskey } = useWalletEntry();
  const { switchChainAsync, isPending: switchingNetwork } = useSwitchChain();
  const usdc = ADDRESSES[143].tokens.USDC as Address;
  const vault = useVaultAddress();
  const [input, setInput] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [lastAction, setLastAction] = useState<"approve" | "deposit" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [submittedAmount, setSubmittedAmount] = useState("");
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
  const { data: gasBalance, refetch: refetchGas } = useBalance({
    address,
    chainId: 143,
    query: { enabled: Boolean(address && isPasskey), refetchInterval: 12_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    chainId: 143,
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && vault ? [address, vault] : undefined,
    query: { enabled: enabled && Boolean(vault) },
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
  const { data: performanceFeeBps } = useReadContract({
    chainId: 143,
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "performanceFeeBps",
    query: { enabled: Boolean(vault) },
  });
  const { data: maxDeposit } = useReadContract({
    chainId: 143,
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "maxDeposit",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(vault && address) },
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
    data: receipt,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    chainId: 143,
    hash,
    query: { enabled: Boolean(hash) },
  });

  const amount = parsedAmount(input);
  const needsApproval = allowance !== undefined && amount > allowance;
  const overBalance = balance !== undefined && amount > balance;
  const overCap = maxDeposit !== undefined && amount > maxDeposit;
  const belowMin = minDeposit !== undefined && amount > 0n && amount < minDeposit;
  const busy = preparing || switchingNetwork || isPending || confirming;
  const ready =
    balance !== undefined &&
    allowance !== undefined &&
    minDeposit !== undefined &&
    maxDeposit !== undefined &&
    previewShares !== undefined;
  const canSubmit =
    isConnected &&
    vault &&
    ready &&
    amount > 0n &&
    !overBalance &&
    !overCap &&
    !belowMin &&
    !busy &&
    (!isPasskey || (gasBalance !== undefined && gasBalance.value > 0n));
  const decimals = shareDecimals ?? 18;
  const performanceFeeText =
    performanceFeeBps === undefined
      ? "The current performance fee rate is unavailable"
      : performanceFeeBps === 0
        ? "No performance fee applies"
        : `A ${Number(performanceFeeBps) / 100}% performance fee applies to profit when you redeem`;
  const fundingNeeded = isPasskey && address && (balance === 0n || gasBalance?.value === 0n);
  const hasActionError = Boolean(
    actionError || error || receiptError || receipt?.status === "reverted",
  );
  const screen: DepositScreen = !isConnected
    ? "connect"
    : receipt?.status === "success" && lastAction === "deposit"
      ? "result"
      : hasActionError
        ? "error"
        : busy
          ? "track"
          : fundingNeeded
            ? "fund"
            : reviewing
              ? "review"
              : "amount";

  useEffect(() => {
    onStageChange?.(screen);
  }, [onStageChange, screen]);

  useEffect(() => {
    if (!receipt || receipt.status !== "success" || !hash || lastRefreshedHash.current === hash)
      return;
    lastRefreshedHash.current = hash;
    void Promise.all([refetchBalance(), refetchAllowance()]);
    if (lastAction === "deposit") showReturnRouteAfterDeposit();
  }, [receipt, hash, lastAction, refetchBalance, refetchAllowance]);

  async function submit() {
    if (!vault || !usdc || !address) return;
    setActionError(null);
    setHash(undefined);
    reset();
    setPreparing(true);
    try {
      if (chainId !== 143) await switchChainAsync({ chainId: 143 });
      if (needsApproval) {
        if (isPasskey)
          await assertContractGas(monadMainnet, address, {
            address: usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [vault, amount],
          });
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
      if (isPasskey)
        await assertContractGas(monadMainnet, address, {
          address: vault,
          abi: deltaMonVaultAbi,
          functionName: "deposit",
          args: [amount, address],
        });
      setLastAction("deposit");
      setSubmittedAmount(input);
      setHash(
        await writeContractAsync({
          address: vault,
          chainId: 143,
          abi: deltaMonVaultAbi,
          functionName: "deposit",
          args: [amount, address],
        }),
      );
    } catch (cause) {
      setActionError(describeRevert(cause));
    } finally {
      setPreparing(false);
    }
  }

  function returnToReview() {
    setActionError(null);
    setHash(undefined);
    reset();
    setReviewing(true);
  }

  function startAnother() {
    setHash(undefined);
    setLastAction(null);
    setSubmittedAmount("");
    setInput("");
    setReviewing(false);
    setActionError(null);
    reset();
  }

  return (
    <div className="deposit-form">
      {!embedded ? (
        <DepositStepIndicator
          current={
            screen === "fund"
              ? "amount"
              : screen === "result" || screen === "error"
                ? "track"
                : screen
          }
        />
      ) : null}
      <div key={screen} className="deposit-stage-screen">
        {screen === "connect" ? (
          <div className="deposit-entry">
            <div className="deposit-entry-badge">
              01 <span>/</span> ACCESS
            </div>
            <h3>Where is your USDC?</h3>
            <p>
              Connect your wallet to see its Monad USDC and review a deposit. Connecting does not
              move funds.
            </p>
            <button type="button" className="deposit-primary-action" onClick={openEntry}>
              Get started ↗
            </button>
          </div>
        ) : null}

        {screen === "fund" && address ? (
          <ReceiveFunds
            address={address}
            onRefresh={() => {
              void refetchBalance();
              void refetchGas();
            }}
          />
        ) : null}

        {screen === "amount" ? (
          <>
            <div className="deposit-form-heading">
              <div>
                <span className="deposit-kicker">{embedded ? "03" : "02"} / SET THE AMOUNT</span>
                <h3>Your USDC in.</h3>
              </div>
              {balance !== undefined ? (
                <button
                  type="button"
                  className="deposit-balance-button"
                  onClick={() => setInput(formatUnits(balance, USDC_DECIMALS))}
                >
                  Use balance · {Number(formatUnits(balance, USDC_DECIMALS)).toLocaleString()} USDC
                </button>
              ) : null}
            </div>
            <label className="deposit-amount-label">
              <span className="sr-only">USDC amount on Monad</span>
              <div className="deposit-amount-field">
                <input
                  aria-label="USDC amount on Monad"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={input}
                  onChange={(event) => setInput(event.target.value.replace(/[^0-9.]/g, ""))}
                  className="deposit-amount-input"
                />
                <span className="deposit-amount-unit">
                  USDC <small>MONAD</small>
                </span>
              </div>
            </label>
            {overBalance ? (
              <p className="text-short mt-2 text-sm">That is more than your balance.</p>
            ) : null}
            {overCap ? (
              <p className="text-short mt-2 text-sm">
                That exceeds the vault&apos;s current deposit capacity.
              </p>
            ) : null}
            {belowMin && minDeposit !== undefined ? (
              <p className="text-short mt-2 text-sm">
                Minimum deposit is {formatUnits(minDeposit, USDC_DECIMALS)} USDC.
              </p>
            ) : null}
            {previewShares !== undefined && amount > 0n && !belowMin ? (
              <div className="deposit-conversion" aria-live="polite">
                <span className="deposit-conversion-arrow" aria-hidden="true">
                  ↘
                </span>
                <div>
                  <span className="deposit-kicker">YOUR ESTIMATED SHARES OUT</span>
                  <strong>
                    {Number(formatUnits(previewShares, decimals)).toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })}{" "}
                    <small>sdMON</small>
                  </strong>
                </div>
              </div>
            ) : null}
            {isConnected && !ready && input ? (
              <p role="status" className="deposit-step-help">
                Checking live balance, allowance, and vault limits before review.
              </p>
            ) : null}
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => setReviewing(true)}
              className="deposit-primary-action"
            >
              Review deposit ↗
            </button>
            <p className="deposit-fineprint">
              The vault allocates your USDC after deposit. The short may not be in place
              immediately; check the latest reported exposure above.
            </p>
          </>
        ) : null}

        {screen === "review" ? (
          <>
            <div className="deposit-review">
              <div className="deposit-review-heading">
                <span className="deposit-kicker">{embedded ? "04" : "03"} / REVIEW YOUR MOVE</span>
                <button type="button" onClick={() => setReviewing(false)}>
                  ← Edit amount
                </button>
              </div>
              <h4>Review your deposit.</h4>
              <dl>
                <div>
                  <dt>You send</dt>
                  <dd className="font-data">{input} USDC</dd>
                </div>
                <div>
                  <dt>Estimated shares</dt>
                  <dd className="font-data">
                    {previewShares === undefined
                      ? "Loading…"
                      : `${Number(formatUnits(previewShares, decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })} sdMON`}
                  </dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>Monad</dd>
                </div>
                <div>
                  <dt>Vault entry fee</dt>
                  <dd>None</dd>
                </div>
              </dl>
              <p className="deposit-review-note">
                Shares are an estimate until the vault confirms. Approval, if needed, is a separate
                wallet transaction. Network gas is paid separately. {performanceFeeText}. sdMON
                represents your share of the whole vault. MON allocation and the offsetting short
                happen separately after deposit.
              </p>
            </div>
            {receipt?.status === "success" && lastAction === "approve" && hash ? (
              <div role="status" className="deposit-state deposit-state-success">
                <span className="deposit-state-symbol" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <strong>USDC approved. Deposit is next.</strong>
                  <p>The allowance is confirmed. Your USDC has not entered the vault yet.</p>
                  <a href={`https://monadvision.com/tx/${hash}`} target="_blank" rel="noreferrer">
                    View approval transaction ↗
                  </a>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className="deposit-primary-action"
            >
              {needsApproval ? "Approve USDC ↗" : "Deposit USDC ↗"}
            </button>
            {chainId !== 143 ? (
              <p className="deposit-step-help">Your wallet will switch to Monad first.</p>
            ) : null}
          </>
        ) : null}

        {screen === "track" ? (
          <div role="status" className="deposit-state deposit-state-pending">
            <span className="deposit-state-symbol" aria-hidden="true">
              ↗
            </span>
            <div>
              <span className="deposit-kicker">WALLET & CHAIN / IN PROGRESS</span>
              <strong>
                {confirming
                  ? "Waiting for Monad confirmation"
                  : isPending
                    ? isPasskey
                      ? "Confirm with passkey"
                      : "Confirm in your wallet"
                    : switchingNetwork
                      ? "Switching to Monad"
                      : "Preparing your transaction"}
              </strong>
              <p>
                {lastAction === "approve"
                  ? "This approval does not deposit USDC. The deposit transaction comes next."
                  : "Submitted is not confirmed. Your deposit completes only after the vault confirms it onchain."}
              </p>
              {hash ? (
                <a href={`https://monadvision.com/tx/${hash}`} target="_blank" rel="noreferrer">
                  Track transaction ↗
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        {screen === "result" && hash ? (
          <div role="status" className="deposit-state deposit-state-success">
            <span className="deposit-state-symbol" aria-hidden="true">
              ✓
            </span>
            <div>
              <span className="deposit-kicker">RECEIPT / CONFIRMED ON MONAD</span>
              <strong>{submittedAmount} USDC deposited.</strong>
              <p>
                The vault confirmed your deposit. Your sdMON shares are in your wallet; see your
                position below for the live balance.
              </p>
              <a href={`https://monadvision.com/tx/${hash}`} target="_blank" rel="noreferrer">
                View confirmed transaction ↗
              </a>
              <button type="button" className="deposit-primary-action" onClick={startAnother}>
                Make another deposit ↗
              </button>
            </div>
          </div>
        ) : null}

        {screen === "error" ? (
          <div role="alert" className="deposit-state deposit-state-error">
            <span className="deposit-state-symbol" aria-hidden="true">
              !
            </span>
            <div>
              <span className="deposit-kicker">ACTION NEEDS ATTENTION</span>
              <strong>
                {lastAction === "approve"
                  ? "Approval did not complete."
                  : "Deposit did not complete."}
              </strong>
              <p>
                {receipt?.status === "reverted"
                  ? "The transaction reverted onchain. Your deposit was not completed."
                  : (actionError ?? describeRevert(receiptError ?? error))}
              </p>
              <p>Your {input} USDC amount is saved. Review it and retry when ready.</p>
              <button type="button" className="deposit-primary-action" onClick={returnToReview}>
                Return to review ↗
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DepositPanel() {
  const [crossChainEnabled, setCrossChainEnabled] = useState(false);
  const [routeSource, setRouteSource] = useState("Monad");
  const [monadStage, setMonadStage] = useState<DepositStep>("amount");

  useEffect(() => {
    void fetch("/api/crosschain/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config: { enabled?: boolean }) => setCrossChainEnabled(config.enabled === true))
      .catch(() => setCrossChainEnabled(false));
  }, []);

  return (
    <section className="deposit-docket" aria-labelledby="deposit-title">
      <div className="deposit-docket-topline">
        <h2 id="deposit-title">DEPOSIT / STRATEGY 01</h2>
        <span>{routeSource.toUpperCase()} USDC → sdMON / MONAD</span>
      </div>
      <div className="deposit-docket-form">
        {crossChainEnabled ? (
          <CrossChainDepositPanel
            monadPanel={
              <MonadDepositPanel
                embedded
                onStageChange={(stage) =>
                  setMonadStage(
                    stage === "fund"
                      ? "amount"
                      : stage === "result" || stage === "error"
                        ? "track"
                        : stage,
                  )
                }
              />
            }
            monadStage={monadStage}
            onSourceChange={setRouteSource}
          />
        ) : (
          <MonadDepositPanel />
        )}
      </div>
      <div className="deposit-docket-footer">
        <span>DELTAMON! / MONAD</span>
        <span>ESTIMATES ARE NOT CONFIRMATIONS</span>
      </div>
    </section>
  );
}
