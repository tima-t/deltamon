import { type Address } from "viem";
import { sdMonVaultAbi, type KeeperStatus } from "@deltamon/shared";
import { env } from "../config.js";
import { getKeeperWallet, publicClient } from "../chain.js";
import { logger } from "../lib/logger.js";

/**
 * Keeper: watches the vault's MON allocation and calls `rebalance()` when it drifts past the
 * vault's threshold. It holds KEEPER_ROLE only — it can never move user funds out of the vault.
 */
export class Keeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private status: KeeperStatus = {
    enabled: env.KEEPER_ENABLED,
    dryRun: !env.KEEPER_PRIVATE_KEY,
    lastRunAt: null,
    lastAction: null,
    lastError: null,
  };

  getStatus(): KeeperStatus {
    return { ...this.status };
  }

  start(): void {
    if (this.timer) return;
    logger.info(
      { intervalMs: env.KEEPER_INTERVAL_MS, dryRun: this.status.dryRun },
      "keeper started",
    );
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), env.KEEPER_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.status.lastRunAt = new Date().toISOString();
    try {
      this.status.lastAction = await this.tick();
      this.status.lastError = null;
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "keeper tick failed");
    } finally {
      this.running = false;
    }
  }

  private async tick(): Promise<string> {
    if (!env.VAULT_ADDRESS) return "skipped: VAULT_ADDRESS not set";

    const vault = env.VAULT_ADDRESS as Address;
    const c = { address: vault, abi: sdMonVaultAbi } as const;
    const [driftBps, thresholdBps, paused] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { ...c, functionName: "allocationDriftBps" },
        { ...c, functionName: "rebalanceThresholdBps" },
        { ...c, functionName: "paused" },
      ],
    });

    if (paused) return "skipped: vault paused";

    const drift = Number(driftBps);
    const threshold = Math.max(Number(thresholdBps), env.REBALANCE_THRESHOLD_BPS);
    if (Math.abs(drift) <= threshold) {
      return `noop: MON allocation drift ${drift} bps within ${threshold} bps`;
    }

    const wallet = getKeeperWallet();
    if (!wallet || !wallet.account) {
      logger.warn({ drift }, "would rebalance (dry run, no KEEPER_PRIVATE_KEY)");
      return `dry-run: would rebalance at drift ${drift} bps`;
    }

    const { request } = await publicClient.simulateContract({
      ...c,
      functionName: "rebalance",
      account: wallet.account,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    logger.info({ hash, status: receipt.status, drift }, "rebalanced");
    return `rebalanced in ${hash} (${receipt.status})`;
  }
}

export const keeper = new Keeper();
