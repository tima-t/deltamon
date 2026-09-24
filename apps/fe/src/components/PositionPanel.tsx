"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { getDeployment } from "@deltamon/shared";
import { redemptionPayout } from "@/lib/positionFeedback";
import { VAULT_ABI, fmtShares, fmtUsdc, useVaultAction } from "@/lib/vault";
import { useWalletEntry } from "./WalletEntry";

type PositionIntent = {
  kind: "redeem" | "redeemInKind";
  shares?: bigint;
};

function parseShares(value: string): bigint {
  try {
    return /^\d+(\.\d+)?$/.test(value) ? parseUnits(value, 18) : 0n;
  } catch {
    return 0n;
  }
}

function PositionActionFeedback({
  intent,
  action,
  payout,
}: {
  intent: PositionIntent | null;
  action: ReturnType<typeof useVaultAction>;
  payout: bigint | undefined;
}) {
  const reduceMotion = useReducedMotion();
  const { isPasskey } = useWalletEntry();
  if (!intent) return null;

  const phase = action.error
    ? "error"
    : action.confirmed
      ? "success"
      : action.awaitingChain
        ? "chain"
        : action.awaitingWallet
          ? "wallet"
          : "preparing";
  const actionName = intent.kind === "redeem" ? "redemption" : "in-kind exit";
  const title =
    phase === "error"
      ? `${actionName.charAt(0).toUpperCase()}${actionName.slice(1)} did not complete`
      : phase === "preparing"
        ? `Preparing ${actionName}`
        : phase === "wallet"
          ? isPasskey
            ? `Confirm ${actionName} with your passkey`
            : `Confirm ${actionName} in your wallet`
          : phase === "chain"
            ? `${actionName.charAt(0).toUpperCase()}${actionName.slice(1)} submitted to Monad`
            : intent.kind === "redeem"
              ? "Redemption complete"
              : "In-kind exit complete";
  const detail =
    phase === "error"
      ? `${action.error} ${intent.shares !== undefined ? "Your entered amount is still here so you can try again." : "You can try again."}`
      : phase === "preparing"
        ? "Checking the vault and network before the wallet request. No position has changed yet."
        : phase === "wallet"
          ? isPasskey
            ? "Waiting for passkey verification. No vault position has changed yet."
            : "Waiting for your wallet confirmation. No vault position has changed yet."
          : phase === "chain"
            ? "The transaction is on its way. Your position updates after onchain confirmation."
            : intent.kind === "redeem"
              ? `${fmtShares(intent.shares)} sdMON redeemed. ${payout === undefined ? "USDC was sent to your wallet." : `${fmtUsdc(payout)} USDC was sent to your wallet.`}`
              : `${fmtShares(intent.shares)} sdMON exited. Your share of liquid vault assets was sent to your wallet.`;

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={`${intent.kind}-${action.hash ?? "wallet"}-${phase}`}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
        className="transaction-feedback mt-4 rounded-xl border p-4"
        data-tone={phase === "success" ? "success" : phase === "error" ? "error" : "pending"}
        role={phase === "error" ? "alert" : "status"}
        aria-atomic="true"
      >
        <div className="flex items-start gap-3">
          {phase === "success" ? (
            <motion.span
              aria-hidden="true"
              className="feedback-icon grid size-9 shrink-0 place-items-center rounded-full"
              initial={reduceMotion ? false : { scale: 0.25, opacity: 0, filter: "blur(4px)" }}
              animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
              transition={{ type: "spring", duration: reduceMotion ? 0 : 0.3, bounce: 0 }}
            >
              ✓
            </motion.span>
          ) : phase === "error" ? (
            <span
              aria-hidden="true"
              className="feedback-icon grid size-9 shrink-0 place-items-center rounded-full"
            >
              !
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="feedback-icon grid size-9 shrink-0 place-items-center rounded-full"
            >
              <span className="feedback-spinner size-4 rounded-full border-2" />
            </span>
          )}
          <div className="min-w-0">
            <p className="font-semibold">{title}</p>
            <p className="text-muted mt-1 text-sm leading-relaxed">{detail}</p>
            {action.hash ? (
              <a
                href={`https://monadvision.com/tx/${action.hash}`}
                target="_blank"
                rel="noreferrer"
                className="text-monad mt-2 inline-block text-sm font-medium underline underline-offset-4"
              >
                View transaction ↗
              </a>
            ) : null}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export function PositionPanel() {
  const { address } = useAccount();
  const { openEntry } = useWalletEntry();
  const vault = (process.env.NEXT_PUBLIC_VAULT_ADDRESS || getDeployment(143)?.vault) as
    Address | undefined;
  const [amountText, setAmountText] = useState("");
  const [intent, setIntent] = useState<PositionIntent | null>(null);
  const intentRef = useRef<PositionIntent | null>(null);
  const { data, refetch, isPending } = useReadContracts({
    allowFailure: true,
    contracts: ["balanceOf", "maxRedeem", "costBasis", "availableLiquidity", "oracleIsLive"].map(
      (functionName) => ({
        address: vault,
        abi: VAULT_ABI,
        functionName,
        args: ["balanceOf", "maxRedeem", "costBasis"].includes(functionName) ? [address] : [],
        chainId: 143,
      }),
    ),
    query: { enabled: Boolean(vault && address), refetchInterval: 12_000 },
  });
  const read = (index: number): bigint =>
    data?.[index]?.status === "success" && typeof data[index].result === "bigint"
      ? (data[index].result as bigint)
      : 0n;
  const positionReady = data?.[0]?.status === "success" && data?.[1]?.status === "success";
  const shares = read(0);
  const maxRedeem = read(1);
  const costBasis = read(2);
  const liquidity = read(3);
  const oracleDown = data?.[4]?.status === "success" && data[4].result === false;
  const amount = parseShares(amountText);

  const onConfirmed = useCallback(() => {
    void refetch();
    if (intentRef.current) setAmountText("");
  }, [refetch, setAmountText]);
  const action = useVaultAction(vault, 143, onConfirmed);
  const payout = redemptionPayout(action.receipt?.logs, vault, address);
  const startAction = (next: PositionIntent, args: readonly unknown[], label: string) => {
    intentRef.current = next;
    setIntent(next);
    void action.run(next.kind, args, label);
  };

  return (
    <div className="panel p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Your position / 04</p>
          <h2 className="mt-2 text-2xl font-semibold">Your exit stays visible</h2>
          <p className="text-muted mt-2 max-w-2xl text-sm">
            Redeem straight out of the vault&apos;s idle USDC. If the book is deployed and there is
            not enough, you wait for the admin to unwind, and you can see exactly how much is
            available.
          </p>
        </div>
        <span className="status-pill" data-tone="muted">
          MONAD VAULT
        </span>
      </div>
      {!address ? (
        <button
          type="button"
          onClick={openEntry}
          className="button-primary mt-6 rounded-xl px-5 py-3 font-semibold"
        >
          Get started to view position
        </button>
      ) : !vault ? (
        <p className="text-muted mt-6 text-sm">Vault address is not configured.</p>
      ) : !positionReady ? (
        <p role="status" className="text-muted mt-6 text-sm">
          {isPending
            ? "Reading your vault position…"
            : "Your position could not be read from Monad right now. Try again shortly."}
        </p>
      ) : (
        <>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            <div className="metric-card">
              <p className="metric-label">Your shares</p>
              <p className="metric-value">{fmtShares(shares)}</p>
              <p className="text-muted text-xs">sdMON</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Redeemable now</p>
              <p className="metric-value">
                {data?.[1]?.status === "success" ? fmtShares(maxRedeem) : "—"}
              </p>
              <p className="text-muted text-xs">sdMON limited by idle USDC</p>
            </div>
            <div className="metric-card">
              <p className="metric-label">Paid in</p>
              <p className="metric-value">
                {data?.[2]?.status === "success" ? fmtUsdc(costBasis) : "—"}
              </p>
              <p className="text-muted text-xs">USDC cost basis</p>
            </div>
          </div>
          <div className="border-line mt-8 rounded-xl border p-5">
            <h3 className="text-lg font-semibold">Redeem</h3>
            <p className="text-muted mt-1 text-xs">
              The vault currently has {data?.[3]?.status === "success" ? fmtUsdc(liquidity) : "—"}{" "}
              USDC available for exits. A performance fee applies only to profit.
            </p>
            <label className="mt-4 block text-sm" htmlFor="redeem-amount">
              Amount in sdMON
            </label>
            <div className="border-line mt-1 flex overflow-hidden rounded-lg border">
              <input
                id="redeem-amount"
                inputMode="decimal"
                value={amountText}
                disabled={action.busy}
                onChange={(event) => {
                  setAmountText(event.target.value.replace(/[^0-9.]/g, ""));
                  setIntent(null);
                }}
                placeholder="0.00"
                className="min-w-0 flex-1 bg-transparent px-3 py-3 text-lg tabular-nums outline-none disabled:opacity-60"
              />
              <button
                type="button"
                disabled={action.busy}
                onClick={() => {
                  setAmountText(formatUnits(maxRedeem, 18));
                  setIntent(null);
                }}
                className="text-monad px-3 text-xs font-semibold disabled:opacity-50"
              >
                MAX
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  action.busy ||
                  data?.[1]?.status !== "success" ||
                  amount <= 0n ||
                  amount > maxRedeem
                }
                onClick={() =>
                  startAction(
                    { kind: "redeem", shares: amount },
                    [amount, address, address],
                    "redeem sdMON",
                  )
                }
                className="button-primary rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {intent?.kind === "redeem" && action.awaitingWallet
                  ? "Confirm in wallet…"
                  : intent?.kind === "redeem" && action.preparing
                    ? "Preparing…"
                    : intent?.kind === "redeem" && action.awaitingChain
                      ? "Redeeming…"
                      : "Redeem now"}
              </button>
              {oracleDown ? (
                <button
                  type="button"
                  disabled={action.busy || amount <= 0n || amount > shares}
                  onClick={() =>
                    startAction(
                      { kind: "redeemInKind", shares: amount },
                      [amount, address],
                      "redeem in kind",
                    )
                  }
                  className="button-secondary rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Exit in kind
                </button>
              ) : null}
            </div>
            <PositionActionFeedback intent={intent} action={action} payout={payout} />
            {amount > maxRedeem && amount <= shares ? (
              <p className="text-muted mt-3 text-xs">
                That is more than the idle USDC can pay right now. Redeem up to{" "}
                {fmtShares(maxRedeem)} sdMON, or wait for the admin to bring liquidity back.
              </p>
            ) : null}
            {oracleDown ? (
              <p className="text-short mt-2 text-xs">
                The oracle is down. An in-kind exit returns your share of idle USDC, wrapped MON and
                AUSD; staked MON and the manager book stay with remaining holders. No performance
                fee applies.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
