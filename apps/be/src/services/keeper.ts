import { type Address } from "viem";
import { deltaVaultAbi, type KeeperStatus } from "@deltamon/shared";
import { env } from "../config.js";
import { getKeeperWallet, publicClient } from "../chain.js";
import { logger } from "../lib/logger.js";

/**
 * Keeper: watches net delta and calls `rebalance()` on the vault when it drifts
 * past the threshold. It holds KEEPER_ROLE only — it can never move user funds
 * out of the vault, which is what keeps the product non-custodial.
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
    if (!env.VAULT_ADDRESS) {
      return "skipped: VAULT_ADDRESS not set";
    }
    const vault = env.VAULT_ADDRESS as Address;
    const contract = { address: vault, abi: deltaVaultAbi } as const;
    const [netDeltaBps, paused] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { ...contract, functionName: "netDeltaBps" },
        { ...contract, functionName: "paused" },
      ],
    });

    if (paused) return "skipped: vault paused";

    const drift = Math.abs(Number(netDeltaBps));
    if (drift < env.REBALANCE_THRESHOLD_BPS) {
      return `noop: delta ${netDeltaBps} bps within ${env.REBALANCE_THRESHOLD_BPS} bps`;
    }

    const wallet = getKeeperWallet();
    if (!wallet || !wallet.account) {
      logger.warn({ netDeltaBps }, "would rebalance (dry run, no KEEPER_PRIVATE_KEY)");
      return `dry-run: would rebalance at delta ${netDeltaBps} bps`;
    }

    const { request } = await publicClient.simulateContract({
      ...contract,
      functionName: "rebalance",
      args: ["0x"],
      account: wallet.account,
    });
    const hash = await wallet.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    logger.info({ hash, status: receipt.status, netDeltaBps }, "rebalanced");
    return `rebalanced in ${hash} (${receipt.status})`;
  }
}

export const keeper = new Keeper();
