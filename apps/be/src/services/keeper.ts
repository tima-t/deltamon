import {
  BaseError,
  ContractFunctionRevertedError,
  erc20Abi,
  formatEther,
  formatUnits,
  isAddressEqual,
  parseEther,
  zeroAddress,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { deltaMonVaultAbi, type KeeperStatus } from "@deltamon/shared";
import { env } from "../config.js";
import { getKeeperWallet, publicClient } from "../chain.js";
import { logger } from "../lib/logger.js";
import { fetchPerpBook, type PerpBook } from "./perpBook.js";
import { planPerpMark } from "./keeperPlan.js";

const abi = deltaMonVaultAbi;
const WITHDRAW_SLOTS = Array.from({ length: 256 }, (_, i) => i);

interface VaultState {
  vault: Address;
  nowSec: bigint;
  deployed: bigint;
  reportedPnl: bigint;
  reportedAt: bigint;
  maxAgeSec: bigint;
  bandBps: bigint;
  oracleLive: boolean;
  totalAssets: bigint;
  totalSupply: bigint;
  liquidity: bigint;
  assetDecimals: number;
  keeper: Address;
  owner: Address;
}

interface TickResult {
  actions: string[];
  alerts: string[];
  errors: string[];
}

/**
 * Keeper for DeltaMonVault. It holds the vault's keeper role, which can mark the perp book inside
 * the band and claim staking rewards, and nothing else: it cannot trade, stake, fund a manager or
 * move funds out. Everything else it does is permissionless upkeep anyone could do.
 *
 * Each tick runs these steps, each on its own so one failure never blocks the rest:
 *  1. Mark the perp book from PERP_BOOK_URL when the mark is stale, due, or the book has moved.
 *  2. Claim staking rewards from each of VALIDATOR_IDS, often, so no claim is worth sandwiching.
 *  3. Claim unbonded MON that has matured.
 * It also raises alerts for what only the admin can fix: no idle USDC left for exits, an oracle
 * outage, a stale mark, a loss past the keeper's band.
 *
 * Without KEEPER_PRIVATE_KEY it runs dry: it simulates every call and logs what it would send.
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
    alerts: [],
  };

  getStatus(): KeeperStatus {
    return { ...this.status, alerts: [...this.status.alerts] };
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
      const { actions, alerts, errors } = await this.tick();
      this.status.lastAction = actions.length > 0 ? actions.join("; ") : "noop";
      this.status.alerts = alerts;
      this.status.lastError = errors.length > 0 ? errors.join("; ") : null;
      for (const alert of alerts) logger.warn({ alert }, "keeper alert");
    } catch (err) {
      this.status.lastError = describe(err);
      logger.error({ err }, "keeper tick failed");
    } finally {
      this.running = false;
    }
  }

  private async tick(): Promise<TickResult> {
    const result: TickResult = { actions: [], alerts: [], errors: [] };
    if (!env.VAULT_ADDRESS) {
      result.actions.push("skipped: VAULT_ADDRESS not set");
      return result;
    }

    const s = await readState(env.VAULT_ADDRESS as Address);
    const wallet = getKeeperWallet();
    // Without a key, simulate as the vault's own keeper, or its admin, so a dry run shows real results.
    const caller =
      wallet?.account?.address ?? (isAddressEqual(s.keeper, zeroAddress) ? s.owner : s.keeper);
    const authorised = isAddressEqual(caller, s.keeper) || isAddressEqual(caller, s.owner);

    if (s.totalSupply > 0n && s.liquidity === 0n) {
      result.alerts.push(
        "no idle USDC left: holders cannot redeem until the admin unwinds part of the book",
      );
    }
    if (!s.oracleLive) {
      result.alerts.push(
        "the oracle cannot price MON; deposits and normal exits revert, redeemInKind is open",
      );
    }
    if (!authorised) {
      result.alerts.push(
        `keeper key ${caller} is not the vault's keeper (${s.keeper}); the admin must call setKeeper`,
      );
    }

    const steps: [string, () => Promise<string[]>][] = [
      [
        "mark perp book",
        () => (authorised ? this.markPerpBook(s, wallet, caller, result.alerts) : none()),
      ],
      ["claim rewards", () => (authorised ? this.claimRewards(s, wallet, caller) : none())],
      ["claim unbonded MON", () => this.claimUnbonded(s, wallet, caller)],
    ];
    for (const [name, run] of steps) {
      try {
        result.actions.push(...(await run()));
      } catch (err) {
        result.errors.push(`${name}: ${describe(err)}`);
        logger.error({ err, step: name }, "keeper step failed");
      }
    }
    return result;
  }

  private async markPerpBook(
    s: VaultState,
    wallet: WalletClient | null,
    caller: Address,
    alerts: string[],
  ): Promise<string[]> {
    if (s.deployed === 0n) return [];
    let book: PerpBook | null = null;
    if (env.PERP_BOOK_URL) {
      try {
        book = await fetchPerpBook(env.PERP_BOOK_URL);
      } catch (err) {
        alerts.push(`perp book feed unreachable: ${describe(err)}`);
      }
    }
    const plan = planPerpMark({
      deployed: s.deployed,
      reportedPnl: s.reportedPnl,
      reportedAt: s.reportedAt,
      maxAgeSec: s.maxAgeSec,
      bandBps: s.bandBps,
      nowSec: s.nowSec,
      minChangeBps: BigInt(env.PERP_MARK_MIN_CHANGE_BPS),
      maxBookAgeSec: BigInt(env.PERP_BOOK_MAX_AGE_SEC),
      book,
    });
    if (plan.kind === "idle") return [];
    alerts.push(...plan.alerts);
    if (plan.kind === "skip") return [];

    const mark = formatUnits(plan.pnl, s.assetDecimals);
    const call = {
      address: s.vault,
      abi,
      functionName: "reportPerpPnl",
      args: [plan.pnl],
    } as const;
    if (!wallet?.account) {
      await publicClient.simulateContract({ ...call, account: caller });
      return [`dry-run: would mark the perp book at ${mark} (${plan.reason})`];
    }
    const { request } = await publicClient.simulateContract({ ...call, account: wallet.account });
    const hash = await confirm(await wallet.writeContract(request));
    return [`marked the perp book at ${mark} (${plan.reason}) in ${hash}`];
  }

  private async claimRewards(
    s: VaultState,
    wallet: WalletClient | null,
    caller: Address,
  ): Promise<string[]> {
    const lines: string[] = [];
    const minimum = parseEther(env.REWARDS_MIN_CLAIM_MON);
    for (const id of env.VALIDATOR_IDS) {
      const call = {
        address: s.vault,
        abi,
        functionName: "claimStakingRewards",
        args: [id],
      } as const;
      if (!wallet?.account) {
        const { result } = await publicClient.simulateContract({ ...call, account: caller });
        if (result > 0n && result >= minimum) {
          lines.push(
            `dry-run: would claim ${formatEther(result)} MON of rewards from validator ${id}`,
          );
        }
        continue;
      }
      const { result, request } = await publicClient.simulateContract({
        ...call,
        account: wallet.account,
      });
      if (result === 0n || result < minimum) continue;
      const hash = await confirm(await wallet.writeContract(request));
      lines.push(`claimed ${formatEther(result)} MON of rewards from validator ${id} in ${hash}`);
    }
    return lines;
  }

  private async claimUnbonded(
    s: VaultState,
    wallet: WalletClient | null,
    caller: Address,
  ): Promise<string[]> {
    const lines: string[] = [];
    for (const id of env.VALIDATOR_IDS) {
      const pending = await publicClient.multicall({
        allowFailure: false,
        contracts: WITHDRAW_SLOTS.map(
          (slot) =>
            ({ address: s.vault, abi, functionName: "pendingUnstake", args: [id, slot] }) as const,
        ),
      });
      for (const [slot, amount] of pending.entries()) {
        if (amount === 0n) continue;
        const label = `${formatEther(amount)} unbonded MON (validator ${id}, slot ${slot})`;
        const call = {
          address: s.vault,
          abi,
          functionName: "claimUnstaked",
          args: [id, slot],
        } as const;
        try {
          if (!wallet?.account) {
            await publicClient.simulateContract({ ...call, account: caller });
            lines.push(`dry-run: would claim ${label}`);
            continue;
          }
          const { request } = await publicClient.simulateContract({
            ...call,
            account: wallet.account,
          });
          const hash = await confirm(await wallet.writeContract(request));
          lines.push(`claimed ${label} in ${hash}`);
        } catch (err) {
          if (isRevert(err)) continue; // still unbonding
          throw err;
        }
      }
    }
    return lines;
  }
}

async function readState(vault: Address): Promise<VaultState> {
  const c = { address: vault, abi } as const;
  const [block, values] = await Promise.all([
    publicClient.getBlock(),
    publicClient.multicall({
      allowFailure: false,
      contracts: [
        { ...c, functionName: "perpDeployed" },
        { ...c, functionName: "perpReportedPnl" },
        { ...c, functionName: "perpReportedAt" },
        { ...c, functionName: "perpReportMaxAge" },
        { ...c, functionName: "perpPnlBandBps" },
        { ...c, functionName: "oracleIsLive" },
        { ...c, functionName: "totalAssets" },
        { ...c, functionName: "totalSupply" },
        { ...c, functionName: "availableLiquidity" },
        { ...c, functionName: "keeper" },
        { ...c, functionName: "owner" },
        { ...c, functionName: "asset" },
      ],
    }),
  ]);
  const [
    deployed,
    reportedPnl,
    reportedAt,
    maxAge,
    bandBps,
    oracleLive,
    totalAssets,
    totalSupply,
    liquidity,
    keeper,
    owner,
    asset,
  ] = values;
  const assetDecimals = await publicClient.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "decimals",
  });
  return {
    vault,
    nowSec: block.timestamp,
    deployed,
    reportedPnl,
    reportedAt,
    maxAgeSec: BigInt(maxAge),
    bandBps: BigInt(bandBps),
    oracleLive,
    totalAssets,
    totalSupply,
    liquidity,
    assetDecimals,
    keeper,
    owner,
  };
}

/** Waits for a sent transaction and fails loudly if it reverted. */
async function confirm(hash: Hash): Promise<Hash> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return hash;
}

function isRevert(err: unknown): boolean {
  return (
    err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError) !== null
  );
}

function describe(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}

const none = async (): Promise<string[]> => [];

export const keeper = new Keeper();
