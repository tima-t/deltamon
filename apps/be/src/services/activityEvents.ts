import { formatUnits, parseAbiItem, type AbiEvent, type Log } from "viem";
import { ADDRESSES, type Activity } from "@deltamon/shared";
import { env } from "../config.js";

/**
 * Which vault events become activity, and how each one reads in English.
 *
 * Everything a person can do to the vault is here, so the log is not just the automation talking
 * to itself: deposits and exits, the admin's swaps and staking, funding a manager and getting it
 * back, and the marks in between.
 */

const asBig = (v: unknown): bigint => (typeof v === "bigint" ? v : 0n);
const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Rounds for reading. A log line does not need eighteen decimals of a share balance. */
function amount(value: unknown, decimals: number, places = 4): string {
  const n = Number(formatUnits(asBig(value), decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: places });
}

const usdc = (v: unknown) => amount(v, 6, 2);
const mon = (v: unknown) => amount(v, 18, 4);

export interface EventSpec {
  event: AbiEvent;
  kind: string;
  /** A line a person can read without opening the transaction. */
  summary: (args: Record<string, unknown>) => string;
  /** Who did it, when the event says. */
  actor?: (args: Record<string, unknown>) => string | null;
  source?: Activity["source"];
}

export const VAULT_EVENTS: EventSpec[] = [
  {
    event: parseAbiItem(
      "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
    ),
    kind: "vault.deposit",
    summary: (a) => `${usdc(a.assets)} USDC deposited for ${mon(a.shares)} sdMON`,
    actor: (a) => asStr(a.owner),
  },
  {
    event: parseAbiItem(
      "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
    ),
    kind: "vault.redeem",
    summary: (a) => `${mon(a.shares)} sdMON redeemed for ${usdc(a.assets)} USDC`,
    actor: (a) => asStr(a.owner),
  },
  {
    event: parseAbiItem(
      "event RedeemedInKind(address indexed owner, address indexed receiver, uint256 shares, uint256 assetsOut, uint256 monOut, uint256 ausdOut)",
    ),
    kind: "vault.redeemInKind",
    summary: (a) =>
      `${mon(a.shares)} sdMON exited in kind: ${usdc(a.assetsOut)} USDC, ${mon(a.monOut)} MON, ${usdc(a.ausdOut)} AUSD`,
    actor: (a) => asStr(a.owner),
  },
  {
    event: parseAbiItem(
      "event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)",
    ),
    kind: "vault.swap",
    // Decimals differ per token, so the raw amounts are left to the transaction and the line names
    // the pair. Guessing six or eighteen here would misreport half the swaps.
    summary: (a) => `Swapped ${shortToken(asStr(a.tokenIn))} for ${shortToken(asStr(a.tokenOut))}`,
  },
  {
    event: parseAbiItem("event Staked(uint64 indexed validatorId, uint256 monAmount)"),
    kind: "vault.stake",
    summary: (a) => `Staked ${mon(a.monAmount)} MON with validator ${String(a.validatorId)}`,
  },
  {
    event: parseAbiItem(
      "event Unstaked(uint64 indexed validatorId, uint8 withdrawId, uint256 monAmount)",
    ),
    kind: "vault.unstake",
    summary: (a) =>
      `Began unbonding ${mon(a.monAmount)} MON from validator ${String(a.validatorId)}`,
  },
  {
    event: parseAbiItem(
      "event UnstakeClaimed(uint64 indexed validatorId, uint8 withdrawId, uint256 monReceived)",
    ),
    kind: "vault.unstakeClaimed",
    summary: (a) => `Claimed ${mon(a.monReceived)} unbonded MON`,
  },
  {
    event: parseAbiItem(
      "event StakingRewardsClaimed(uint64 indexed validatorId, uint256 monReceived)",
    ),
    kind: "vault.rewards",
    summary: (a) =>
      `Claimed ${mon(a.monReceived)} MON of staking rewards from validator ${String(a.validatorId)}`,
  },
  {
    event: parseAbiItem(
      "event SentToPerpManager(address indexed manager, address indexed token, uint256 amount, uint256 outstanding)",
    ),
    kind: "vault.fundManager",
    summary: (a) => `Sent ${usdc(a.amount)} ${shortToken(asStr(a.token))} to a perp manager`,
    actor: (a) => asStr(a.manager),
  },
  {
    event: parseAbiItem(
      "event ReturnedByPerpManager(address indexed manager, address indexed token, uint256 amount, uint256 outstanding)",
    ),
    kind: "vault.managerReturn",
    summary: (a) =>
      `A perp manager returned ${usdc(a.amount)} ${shortToken(asStr(a.token))}, ${usdc(a.outstanding)} still out`,
    actor: (a) => asStr(a.manager),
  },
  {
    event: parseAbiItem("event PerpPnlReported(int256 pnl, uint256 deployed)"),
    kind: "vault.perpMark",
    summary: (a) => {
      const pnl = typeof a.pnl === "bigint" ? a.pnl : 0n;
      return `Perp book marked at ${pnl < 0n ? "−" : "+"}${usdc(pnl < 0n ? -pnl : pnl)} USDC`;
    },
  },
  {
    event: parseAbiItem("event PerpManagerSet(address indexed manager, bool allowed)"),
    kind: "vault.managerSet",
    summary: (a) => `Perp manager ${a.allowed === true ? "approved" : "removed"}`,
    actor: (a) => asStr(a.manager),
  },
  {
    event: parseAbiItem("event FeesWithdrawn(address indexed to, uint256 amount)"),
    kind: "vault.feesWithdrawn",
    summary: (a) => `${usdc(a.amount)} USDC of accrued fees withdrawn`,
    actor: (a) => asStr(a.to),
  },
];

/**
 * The vault only ever touches three tokens, so a line can name them instead of printing an
 * address nobody recognises.
 */
function shortToken(address: string | null): string {
  if (!address) return "a token";
  const tokens = ADDRESSES[env.CHAIN_ID as keyof typeof ADDRESSES]?.tokens as
    | Record<string, string>
    | undefined;
  for (const [symbol, known] of Object.entries(tokens ?? {})) {
    if (known.toLowerCase() === address.toLowerCase()) return symbol;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** One log becomes one activity row, keyed so a re-scan cannot record it twice. */
export function toActivity(
  spec: EventSpec,
  log: Log & { args?: Record<string, unknown> },
): Activity & { dedupeKey: string } {
  const args = log.args ?? {};
  return {
    at: new Date().toISOString(),
    source: spec.source ?? "onchain",
    kind: spec.kind,
    status: "ok",
    summary: spec.summary(args),
    actor: spec.actor?.(args) ?? null,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber === null ? null : Number(log.blockNumber),
    dedupeKey: `${log.transactionHash}:${log.logIndex}`,
  };
}
