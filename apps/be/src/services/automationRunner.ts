import { formatUnits, type Address, type Log } from "viem";
import { deltaMonVaultAbi, type AutomationConfig } from "@deltamon/shared";
import { env } from "../config.js";
import { getAdminWallet, publicClient } from "../chain.js";
import { logger } from "../lib/logger.js";
import { collection, collections, mongoConfigured } from "../lib/mongo.js";
import { readConfig, recordActivity } from "./automationStore.js";
import { activeFlows, startFlow, tickFlows } from "./flowEngine.js";
import { findMarket, sharedSession } from "./perplAccounts.js";
import { describePosition } from "./perpPositionView.js";
import { confirm, pinNonce, sendPinned } from "./txRunner.js";
import { thresholdUnits, windowKey } from "./automationSchedule.js";
import { VAULT_EVENTS, toActivity } from "./activityEvents.js";

/**
 * What decides when the pipeline runs, and what watches the hedge afterwards.
 *
 * Triggers are turned into a stable key before anything is signed, so the same deposit or the same
 * time window can never start two runs. The unbond monitor is separate: it watches the perp
 * position's liquidation buffer and unbonds the stake when the buffer falls to the configured
 * level.
 */

/** Monad answers eth_getLogs over 100 blocks at most. */
const CHUNK = 100n;
/** Bounded catch-up, so a long outage does not stall a tick for minutes. */
const MAX_CHUNKS_PER_TICK = 20n;
const CURSOR_ID = "deposit-cursor";
/** Never unbond twice for the same dip. */
const UNBOND_COOLDOWN_MS = 60 * 60_000;

interface CursorDoc {
  _id: string;
  block: string;
  lastUnbondAt?: string;
}

async function cursor(): Promise<CursorDoc | null> {
  const docs = await collection<CursorDoc>(collections.config);
  return docs.findOne({ _id: CURSOR_ID });
}

async function setCursor(patch: Partial<CursorDoc>): Promise<void> {
  const docs = await collection<CursorDoc>(collections.config);
  await docs.updateOne({ _id: CURSOR_ID }, { $set: patch }, { upsert: true });
}

/** Idle USDC the vault can actually deploy, which excludes the fees it owes. */
async function deployableUsdc(vault: Address): Promise<bigint> {
  return publicClient.readContract({
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "availableLiquidity",
  });
}

/**
 * Records every vault event as activity, and turns a Deposit into a pipeline run when the trigger
 * is set to that. Keys come from the log itself, so re-scanning a range records nothing twice and
 * cannot start a second run for the same deposit.
 */
async function scanVaultEvents(vault: Address, config: AutomationConfig): Promise<void> {
  const head = await publicClient.getBlockNumber();
  const saved = await cursor();
  // A fresh install starts at the head: old events are history, not work to do.
  let from = saved ? BigInt(saved.block) + 1n : head;
  if (from > head) {
    await setCursor({ block: head.toString() });
    return;
  }

  const limit = from + CHUNK * MAX_CHUNKS_PER_TICK;
  const ceiling = head < limit ? head : limit;
  const byName = new Map(VAULT_EVENTS.map((spec) => [spec.event.name, spec]));

  while (from <= ceiling) {
    const to = from + CHUNK - 1n > ceiling ? ceiling : from + CHUNK - 1n;
    const logs = (await publicClient.getLogs({
      address: vault,
      events: VAULT_EVENTS.map((spec) => spec.event),
      fromBlock: from,
      toBlock: to,
    })) as (Log & { eventName?: string; args?: Record<string, unknown> })[];

    // One block read per block that actually produced a log, so the feed is ordered by when
    // things happened rather than by when this process happened to notice them.
    const times = await blockTimes(logs);

    for (const log of logs) {
      const spec = log.eventName ? byName.get(log.eventName) : undefined;
      if (!spec) continue;
      const entry = toActivity(spec, log);
      const at = log.blockNumber === null ? undefined : times.get(log.blockNumber);
      await recordActivity({ ...entry, at: at ?? entry.at });

      if (spec.kind !== "vault.deposit") continue;
      // The feed records deposits whether or not the automation is on, but a run must not be
      // created while it is off: no step would advance, and the record would sit waiting to
      // execute against a stale deposit the moment someone flipped the switch.
      if (!config.enabled) continue;
      if (config.flowPipelinePeriod !== "deposit") continue;

      // What a run allocates is everything idle, not the deposit that tripped it: with a
      // threshold, several small deposits accumulate and all of it should be put to work.
      const idle = await deployableUsdc(vault);
      if (idle < thresholdUnits(config.minIdleUsdcStart)) continue;
      // One run at a time. Two overlapping runs would both allocate the same idle balance and
      // the second would find it already spent.
      if ((await activeFlows()).length > 0) continue;

      await startFlow(
        `deposit:${log.transactionHash}:${log.logIndex}`,
        "deposit",
        vault,
        idle,
        config,
      );
    }
    await setCursor({ block: to.toString() });
    from = to + 1n;
  }
}

/** Timestamps for the blocks these logs came from, fetched once each. */
async function blockTimes(logs: { blockNumber: bigint | null }[]): Promise<Map<bigint, string>> {
  const wanted = [...new Set(logs.map((l) => l.blockNumber).filter((b) => b !== null))];
  const times = new Map<bigint, string>();
  await Promise.all(
    wanted.map(async (blockNumber) => {
      try {
        const block = await publicClient.getBlock({ blockNumber });
        times.set(blockNumber, new Date(Number(block.timestamp) * 1000).toISOString());
      } catch {
        // Fall back to the scan time rather than drop the event.
      }
    }),
  );
  return times;
}

async function runPeriodic(vault: Address, config: AutomationConfig): Promise<void> {
  if (config.flowPipelinePeriod === "deposit") return;
  const idle = await deployableUsdc(vault);
  if (idle < thresholdUnits(config.minIdleUsdcStart)) return;
  if ((await activeFlows()).length > 0) return;
  await startFlow(
    windowKey(config.flowPipelinePeriod),
    config.flowPipelinePeriod,
    vault,
    idle,
    config,
  );
}

/**
 * Unbonds the whole stake when the short gets close to liquidation. Perpl publishes no liquidation
 * price, so the buffer is the estimate the console shows, and the threshold is deliberately a
 * blunt one: this is a safety valve, not a rebalancer.
 */
async function watchLiquidationBuffer(vault: Address, config: AutomationConfig): Promise<void> {
  if (config.unbondBufferLevel <= 0) return;
  const session = sharedSession();
  if (!session) return;
  const account = session.account();
  if (!account.connected || account.positions.length === 0) return;

  const market = await findMarket("MON").catch(() => null);
  if (!market) return;

  let worst: number | null = null;
  for (const position of account.positions) {
    const view = describePosition(position.raw, market);
    if (view.liquidationBuffer === null) continue;
    worst = worst === null ? view.liquidationBuffer : Math.min(worst, view.liquidationBuffer);
  }
  if (worst === null || worst * 100 > config.unbondBufferLevel) return;

  const saved = await cursor();
  if (saved?.lastUnbondAt && Date.now() - Date.parse(saved.lastUnbondAt) < UNBOND_COOLDOWN_MS) {
    return;
  }

  const staked = await publicClient.readContract({
    address: vault,
    abi: deltaMonVaultAbi,
    functionName: "stakedMon",
  });
  if (staked === 0n) return;

  const wallet = getAdminWallet();
  if (!wallet?.account) return;
  const validator = env.VALIDATOR_IDS[0];
  if (validator === undefined) return;

  // Written before the send: a crash here must not unbond twice on the next tick.
  await setCursor({ lastUnbondAt: new Date().toISOString() });
  await recordActivity({
    source: "pipeline",
    kind: "automation.unbond",
    status: "started",
    summary: `Liquidation buffer at ${(worst * 100).toFixed(1)}%, unbonding ${formatUnits(staked, 18)} MON`,
  });

  try {
    const nonce = await pinNonce(wallet.account.address);
    const { txHash } = await sendPinned(
      wallet,
      {
        address: vault,
        abi: deltaMonVaultAbi,
        functionName: "unstake",
        args: [validator, staked],
      },
      nonce,
    );
    await confirm(txHash);
    await recordActivity({
      source: "pipeline",
      kind: "automation.unbond",
      status: "ok",
      summary: `Unbonded ${formatUnits(staked, 18)} MON from validator ${validator}`,
      txHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "unbond failed");
    await recordActivity({
      source: "pipeline",
      kind: "automation.unbond",
      status: "failed",
      summary: `Unbond failed: ${message}`,
    });
  }
}

export class AutomationRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(intervalMs = 20_000): void {
    if (this.timer) return;
    if (!mongoConfigured()) {
      logger.warn("automation idle: MONGO_CONNECTION_STRING is not set");
      return;
    }
    logger.info({ intervalMs }, "automation runner started");
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const vault = env.VAULT_ADDRESS as Address | undefined;
      if (!vault) return;
      const config = await readConfig();
      // Deposits are logged whatever the switch says, because the activity feed is not automation.
      await scanVaultEvents(vault, config);
      if (!config.enabled) return;
      if (!getAdminWallet()) {
        logger.warn("automation enabled but ADMIN_PRIVATE_KEY is not set");
        return;
      }
      await runPeriodic(vault, config);
      await tickFlows();
      await watchLiquidationBuffer(vault, config);
    } catch (err) {
      logger.error({ err }, "automation tick failed");
    } finally {
      this.running = false;
    }
  }
}

export const automation = new AutomationRunner();
