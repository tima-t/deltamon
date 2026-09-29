import { erc20Abi, formatUnits, type Address, type Hex } from "viem";
import { ADDRESSES, deltaMonVaultAbi, type AutomationConfig, type FlowPeriod } from "@deltamon/shared";
import { env } from "../config.js";
import { getAdminWallet, getManagerWallet, publicClient } from "../chain.js";
import { logger } from "../lib/logger.js";
import { collection, collections } from "../lib/mongo.js";
import { recordActivity } from "./automationStore.js";
import { checkNonce, confirm, pinNonce, sendPinned } from "./txRunner.js";
import { findMarket, sharedSession } from "./perplAccounts.js";
import { openShortFrames } from "./perplOrders.js";

/**
 * The allocation pipeline: idle USDC in, a hedged position out.
 *
 *   1. buy MON with the configured share of the USDC
 *   2. buy AUSD with the rest
 *   3. stake the MON
 *   4. send the AUSD to a perp manager
 *   5. let Perpl pull that AUSD from the manager
 *   6. deposit it as collateral
 *   7. short the same amount of MON that was staked
 *
 * Steps five and six are signed by the manager's own wallet, not the admin's: Perpl collateral can
 * only be moved on chain by whoever holds it, and the trading API key cannot move funds at all.
 *
 * Steps run strictly in order and each one is persisted before and after it acts, so a restart
 * resumes at the step that was in flight rather than from the beginning. A step that fails is
 * retried on the next tick, up to a limit; a step that has already spent its nonce is never sent
 * again. Nothing here runs unless the config says enabled.
 */

export const STEP_NAMES = [
  "swapUsdcForMon",
  "swapUsdcForAusd",
  "stake",
  "fundPerpManager",
  "approvePerplCollateral",
  "depositToPerpl",
  "openShort",
] as const;

/** Which wallet signs which step. The manager's own wallet owns the collateral it deposits. */
const MANAGER_STEPS = new Set<StepName>(["approvePerplCollateral", "depositToPerpl"]);

const PERPL_ABI = [
  {
    type: "function",
    name: "depositCollateral",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;
export type StepName = (typeof STEP_NAMES)[number];

export type StepStatus = "pending" | "sending" | "sent" | "done" | "failed" | "needs-review";

export interface FlowStep {
  name: StepName;
  status: StepStatus;
  attempts: number;
  nonce?: number;
  txHash?: string;
  error?: string;
  /** What the step produced, for the step after it. */
  result?: Record<string, string>;
  startedAt?: string;
  finishedAt?: string;
}

export interface FlowDoc {
  triggerKey: string;
  trigger: FlowPeriod | "manual";
  vault: string;
  /** The USDC this run is allocating, in asset units. */
  usdcIn: string;
  config: AutomationConfig;
  status: "running" | "done" | "failed";
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
}

const MAX_ATTEMPTS = 5;

const newFlow = (
  triggerKey: string,
  trigger: FlowDoc["trigger"],
  vault: Address,
  usdcIn: bigint,
  config: AutomationConfig,
): FlowDoc => ({
  triggerKey,
  trigger,
  vault,
  usdcIn: usdcIn.toString(),
  config,
  status: "running",
  steps: STEP_NAMES.map((name) => ({ name, status: "pending" as StepStatus, attempts: 0 })),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/**
 * Starts a run for this trigger, or does nothing if one already exists. The uniqueness of
 * triggerKey is enforced by the database, so two workers racing on the same deposit cannot both
 * win.
 */
export async function startFlow(
  triggerKey: string,
  trigger: FlowDoc["trigger"],
  vault: Address,
  usdcIn: bigint,
  config: AutomationConfig,
): Promise<boolean> {
  const flows = await collection<FlowDoc>(collections.flows);
  try {
    await flows.insertOne(newFlow(triggerKey, trigger, vault, usdcIn, config));
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // already started
    throw err;
  }
  await recordActivity({
    source: "pipeline",
    kind: "flow.started",
    status: "started",
    summary: `Pipeline started on ${formatUnits(usdcIn, 6)} USDC (${trigger})`,
    flowId: triggerKey,
    dedupeKey: `flow-start:${triggerKey}`,
  });
  logger.info({ triggerKey, trigger, usdcIn: usdcIn.toString() }, "pipeline started");
  return true;
}

export async function activeFlows(): Promise<FlowDoc[]> {
  const flows = await collection<FlowDoc>(collections.flows);
  return flows.find({ status: "running" }).sort({ createdAt: 1 }).limit(5).toArray();
}

export async function recentFlows(limit = 20): Promise<FlowDoc[]> {
  const flows = await collection<FlowDoc>(collections.flows);
  return flows
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

async function patchStep(
  triggerKey: string,
  index: number,
  patch: Partial<FlowStep>,
): Promise<void> {
  const flows = await collection<FlowDoc>(collections.flows);
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) set[`steps.${index}.${k}`] = v;
  await flows.updateOne({ triggerKey }, { $set: set });
}

async function finishFlow(triggerKey: string, status: FlowDoc["status"]): Promise<void> {
  const flows = await collection<FlowDoc>(collections.flows);
  await flows.updateOne(
    { triggerKey },
    { $set: { status, updatedAt: new Date().toISOString() } },
  );
}

/** Advances every running flow by at most one step, so one bad run cannot starve the others. */
export async function tickFlows(): Promise<void> {
  for (const flow of await activeFlows()) {
    try {
      await advance(flow);
    } catch (err) {
      logger.error({ err, triggerKey: flow.triggerKey }, "pipeline step failed");
    }
  }
}

async function advance(flow: FlowDoc): Promise<void> {
  const index = flow.steps.findIndex((s) => s.status !== "done");
  if (index === -1) {
    await finishFlow(flow.triggerKey, "done");
    await recordActivity({
      source: "pipeline",
      kind: "flow.completed",
      status: "ok",
      summary: "Pipeline completed",
      flowId: flow.triggerKey,
      dedupeKey: `flow-done:${flow.triggerKey}`,
    });
    return;
  }

  const step = flow.steps[index]!;
  if (step.status === "needs-review") return; // a person has to look at this one
  if (step.status === "failed" && step.attempts >= MAX_ATTEMPTS) {
    await finishFlow(flow.triggerKey, "failed");
    return;
  }

  // A step caught mid-send is resolved against the chain before anything else is tried.
  if (step.status === "sending" || step.status === "sent") {
    await resolveInFlight(flow, index, step);
    return;
  }

  await runStep(flow, index, step);
}

/** The address that signed a given step, which is what its pinned nonce belongs to. */
function signerFor(step: StepName): Address {
  const wallet = MANAGER_STEPS.has(step) ? getManagerWallet() : getAdminWallet();
  if (!wallet?.account) {
    throw new Error(
      MANAGER_STEPS.has(step) ? "PERP_MANAGER_PRIVATE_KEY is not set" : "ADMIN_PRIVATE_KEY is not set",
    );
  }
  return wallet.account.address;
}

/**
 * Decides what happened to a step that was interrupted between broadcast and confirmation. It
 * never re-sends against a nonce that has already been spent.
 */
async function resolveInFlight(flow: FlowDoc, index: number, step: FlowStep): Promise<void> {
  if (step.txHash) {
    try {
      await confirm(step.txHash as Hex);
      await patchStep(flow.triggerKey, index, {
        status: "done",
        finishedAt: new Date().toISOString(),
      });
      await stepActivity(flow, step, "ok", `${step.name} confirmed`);
    } catch (err) {
      await patchStep(flow.triggerKey, index, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (step.nonce === undefined) {
    await patchStep(flow.triggerKey, index, { status: "pending" });
    return;
  }

  // The nonce belongs to whichever wallet sent this step, not always the admin's.
  const state = await checkNonce(signerFor(step.name), step.nonce);
  if (state.kind === "unused") {
    // Nothing was mined with that nonce, so the send never landed. Safe to try again.
    await patchStep(flow.triggerKey, index, { status: "pending" });
    return;
  }

  // The nonce is spent but we never captured a hash. It was probably ours, but a manual admin
  // transaction from the same address would look identical, so a person decides.
  await patchStep(flow.triggerKey, index, {
    status: "needs-review",
    error: `nonce ${step.nonce} was spent but no receipt was recorded; confirm on chain before retrying`,
  });
  await finishFlow(flow.triggerKey, "failed");
  await stepActivity(
    flow,
    step,
    "failed",
    `${step.name} needs review: nonce ${step.nonce} spent with no receipt`,
  );
  logger.error({ triggerKey: flow.triggerKey, step: step.name }, "step needs manual review");
}

async function stepActivity(
  flow: FlowDoc,
  step: FlowStep,
  status: "started" | "ok" | "failed",
  summary: string,
): Promise<void> {
  await recordActivity({
    source: "pipeline",
    kind: `pipeline.${step.name}`,
    status,
    summary,
    flowId: flow.triggerKey,
    txHash: step.txHash ?? null,
    detail: step.result ?? null,
  });
}

async function runStep(flow: FlowDoc, index: number, step: FlowStep): Promise<void> {
  const usesManager = MANAGER_STEPS.has(step.name);
  const wallet = usesManager ? getManagerWallet() : getAdminWallet();
  if (!wallet?.account) {
    throw new Error(
      usesManager
        ? "PERP_MANAGER_PRIVATE_KEY is not set, so the manager cannot deposit collateral"
        : "ADMIN_PRIVATE_KEY is not set",
    );
  }
  // A wallet with no MON cannot send anything, and the revert it produces says nothing useful.
  if (usesManager) {
    const gas = await publicClient.getBalance({ address: wallet.account.address });
    if (gas === 0n) {
      throw new Error(`manager wallet ${wallet.account.address} holds no MON for gas`);
    }
  }
  const vault = flow.vault as Address;
  const previous = flow.steps.slice(0, index);
  const attempts = step.attempts + 1;

  await patchStep(flow.triggerKey, index, {
    status: "pending",
    attempts,
    startedAt: step.startedAt ?? new Date().toISOString(),
  });

  // The last step is not a chain transaction, so it is handled on its own.
  if (step.name === "openShort") {
    await runOpenShort(flow, index, previous);
    return;
  }

  const plan = await planStep(step.name, flow, vault, previous);
  if (!plan) {
    await patchStep(flow.triggerKey, index, {
      status: "done",
      finishedAt: new Date().toISOString(),
      result: { skipped: "nothing to do" },
    });
    return;
  }

  const nonce = await pinNonce(wallet.account.address);
  // Persisted before the broadcast: this is what makes a crash recoverable.
  await patchStep(flow.triggerKey, index, { status: "sending", nonce });

  try {
    const { txHash } = await sendPinned(wallet, plan.request, nonce);
    await patchStep(flow.triggerKey, index, { status: "sent", txHash });
    await confirm(txHash);
    const result = await plan.settle();
    await patchStep(flow.triggerKey, index, {
      status: "done",
      txHash,
      result,
      finishedAt: new Date().toISOString(),
    });
    await stepActivity(flow, { ...step, txHash, result }, "ok", plan.summary(result));
  } catch (err) {
    const message = explain(err instanceof Error ? err.message : String(err));
    await patchStep(flow.triggerKey, index, { status: "failed", error: message });
    await stepActivity(flow, step, "failed", `${step.name} failed: ${message}`);
    if (attempts >= MAX_ATTEMPTS) await finishFlow(flow.triggerKey, "failed");
  }
}

/** Turns the reverts worth explaining into something a person can act on. */
function explain(message: string): string {
  if (message.includes("AccountDoesNotExist")) {
    return `${message} — the manager has no Perpl account yet. Open one on Perpl with that wallet before the pipeline can deposit collateral.`;
  }
  if (message.includes("insufficient funds for gas")) {
    return `${message} — the signing wallet needs MON for gas.`;
  }
  return message;
}

interface StepPlan {
  request: { address: Address; abi: readonly unknown[]; functionName: string; args: unknown[] };
  /** Reads back what the transaction produced, for the next step. */
  settle: () => Promise<Record<string, string>>;
  summary: (result: Record<string, string>) => string;
}

async function tokenBalance(token: Address, owner: Address): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

async function planStep(
  name: Exclude<StepName, "openShort">,
  flow: FlowDoc,
  vault: Address,
  previous: FlowStep[],
): Promise<StepPlan | null> {
  const usdcIn = BigInt(flow.usdcIn);
  const ratio = flow.config.monAusdSplitRatio;
  const [wmon, ausd] = (await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: vault, abi: deltaMonVaultAbi, functionName: "wmon" },
      { address: vault, abi: deltaMonVaultAbi, functionName: "ausd" },
    ],
  })) as [Address, Address];

  if (name === "swapUsdcForMon") {
    const amount = (usdcIn * BigInt(Math.round(ratio * 10_000))) / 10_000n;
    if (amount === 0n) return null;
    const before = await tokenBalance(wmon, vault);
    return {
      request: {
        address: vault,
        abi: deltaMonVaultAbi,
        functionName: "swapUsdcForMon",
        args: [amount, 0n],
      },
      settle: async () => {
        const after = await tokenBalance(wmon, vault);
        return { usdcIn: amount.toString(), monOut: (after - before).toString() };
      },
      summary: (r) => `Bought ${formatUnits(BigInt(r.monOut ?? "0"), 18)} MON with ${formatUnits(amount, 6)} USDC`,
    };
  }

  if (name === "swapUsdcForAusd") {
    const monShare = (usdcIn * BigInt(Math.round(ratio * 10_000))) / 10_000n;
    const amount = usdcIn - monShare;
    if (amount === 0n) return null;
    const before = await tokenBalance(ausd, vault);
    return {
      request: {
        address: vault,
        abi: deltaMonVaultAbi,
        functionName: "swapUsdcForAusd",
        args: [amount, 0n],
      },
      settle: async () => {
        const after = await tokenBalance(ausd, vault);
        return { usdcIn: amount.toString(), ausdOut: (after - before).toString() };
      },
      summary: (r) => `Bought ${formatUnits(BigInt(r.ausdOut ?? "0"), 6)} AUSD with ${formatUnits(amount, 6)} USDC`,
    };
  }

  if (name === "stake") {
    const bought = BigInt(previous.find((s) => s.name === "swapUsdcForMon")?.result?.monOut ?? "0");
    if (bought === 0n) return null;
    const validator = env.VALIDATOR_IDS[0];
    if (validator === undefined) throw new Error("VALIDATOR_IDS is empty, nothing to stake with");
    return {
      request: {
        address: vault,
        abi: deltaMonVaultAbi,
        functionName: "stake",
        args: [validator, bought],
      },
      settle: async () => ({ staked: bought.toString(), validator: validator.toString() }),
      summary: () => `Staked ${formatUnits(bought, 18)} MON with validator ${validator}`,
    };
  }

  if (name === "approvePerplCollateral" || name === "depositToPerpl") {
    const exchange = ADDRESSES[env.CHAIN_ID as keyof typeof ADDRESSES]?.perpl?.exchange as
      | Address
      | undefined;
    if (!exchange) throw new Error(`no Perpl exchange known for chain ${env.CHAIN_ID}`);
    const wallet = getManagerWallet();
    if (!wallet?.account) throw new Error("PERP_MANAGER_PRIVATE_KEY is not set");
    const holder = wallet.account.address;

    // Deposit whatever the manager is actually holding, not what the previous step sent: a partial
    // earlier run may have left some behind, and it is all collateral either way.
    const held = await tokenBalance(ausd, holder);
    if (held === 0n) return null;

    if (name === "approvePerplCollateral") {
      const allowance = (await publicClient.readContract({
        address: ausd,
        abi: erc20Abi,
        functionName: "allowance",
        args: [holder, exchange],
      })) as bigint;
      if (allowance >= held) return null; // already enough, nothing to sign
      return {
        request: {
          address: ausd,
          abi: erc20Abi,
          functionName: "approve",
          args: [exchange, held],
        },
        settle: async () => ({ approved: held.toString(), spender: exchange }),
        summary: () => `Approved ${formatUnits(held, 6)} AUSD for Perpl`,
      };
    }

    return {
      request: {
        address: exchange,
        abi: PERPL_ABI,
        functionName: "depositCollateral",
        args: [held],
      },
      settle: async () => ({ deposited: held.toString() }),
      summary: () => `Deposited ${formatUnits(held, 6)} AUSD into Perpl as collateral`,
    };
  }

  // fundPerpManager
  const manager = env.PERP_MANAGER_ADDRESS;
  if (!manager) throw new Error("PERP_MANAGER_ADDRESS is not set");
  const bought = BigInt(previous.find((s) => s.name === "swapUsdcForAusd")?.result?.ausdOut ?? "0");
  if (bought === 0n) return null;
  return {
    request: {
      address: vault,
      abi: deltaMonVaultAbi,
      functionName: "sendFundPerpManager",
      args: [manager, ausd, bought],
    },
    settle: async () => ({ sent: bought.toString(), token: "AUSD", manager }),
    summary: () => `Sent ${formatUnits(bought, 6)} AUSD to ${manager}`,
  };
}

/**
 * The hedge. Perpl is funded outside this pipeline, so the short is sized against the collateral
 * already in the account and the step fails plainly when that is not enough.
 */
async function runOpenShort(flow: FlowDoc, index: number, previous: FlowStep[]): Promise<void> {
  const staked = BigInt(previous.find((s) => s.name === "stake")?.result?.staked ?? "0");
  if (staked === 0n) {
    await patchStep(flow.triggerKey, index, {
      status: "done",
      finishedAt: new Date().toISOString(),
      result: { skipped: "nothing was staked" },
    });
    return;
  }

  try {
    const session = sharedSession();
    if (!session) throw new Error("no Perpl credentials on the backend");
    const market = await findMarket("MON");
    if (!market) throw new Error("Perpl has no MON market");

    // Sizes are whole MON: the market carries zero size decimals.
    const size = formatUnits(staked, 18).split(".")[0] ?? "0";
    if (size === "0") throw new Error("staked MON rounds to nothing at the market's size decimals");

    const frames = openShortFrames(
      { market, size, leverage: flow.config.shortLeverage },
      session.nextRequestId,
      session.nextSeq,
    );
    const statuses = await session.submit(frames);
    const refused = statuses.find((s) => !s.accepted);
    if (refused) throw new Error(refused.error ?? `Perpl refused the order (${refused.code})`);

    await patchStep(flow.triggerKey, index, {
      status: "done",
      result: { size, leverage: String(flow.config.shortLeverage) },
      finishedAt: new Date().toISOString(),
    });
    await recordActivity({
      source: "perp",
      kind: "pipeline.openShort",
      status: "ok",
      summary: `Opened a ${size} MON short at ${flow.config.shortLeverage / 100}x`,
      flowId: flow.triggerKey,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = (flow.steps[index]?.attempts ?? 0) + 1;
    await patchStep(flow.triggerKey, index, { status: "failed", error: message });
    await recordActivity({
      source: "perp",
      kind: "pipeline.openShort",
      status: "failed",
      summary: `Could not open the short: ${message}`,
      flowId: flow.triggerKey,
    });
    if (attempts >= MAX_ATTEMPTS) await finishFlow(flow.triggerKey, "failed");
  }
}
