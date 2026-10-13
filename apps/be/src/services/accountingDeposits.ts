import { type Address, formatUnits, parseAbiItem } from "viem";
import { getDeployment } from "@deltamon/shared";
import { publicClient } from "../chain.js";
import { env } from "../config.js";
import { readDepositScan, saveDepositScan, type DepositScan } from "./accountingStore.js";

/**
 * How much USDC has ever been paid into the vault. This is the denominator for strategy return:
 * income earned against the capital depositors actually contributed, not against today's mark.
 *
 * It has to come from the vault's own `Deposit` logs. The contract keeps cost basis per holder
 * and no running total, and summing `costBasis` needs the holder set, which is the same log scan
 * by a longer route.
 *
 * Monad's public RPC answers eth_getLogs over 100 blocks at most, so a scan from the deployment
 * block is tens of thousands of requests. The cursor and running total therefore live in Mongo,
 * not in a container filesystem that a redeploy wipes: a restart resumes where it stopped instead
 * of beginning again. Each tick does a bounded amount of work and the total reads as unavailable
 * until the scan has reached chain head once.
 */

const CHUNK = 100n;
const CONCURRENCY = 8;

const depositEvent = parseAbiItem(
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
);

async function depositsIn(vault: Address, fromBlock: bigint, toBlock: bigint) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await publicClient.getLogs({ address: vault, event: depositEvent, fromBlock, toBlock });
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

export interface DepositTotal {
  /** Null until the scan has reached chain head; a partial sum is not a total. */
  totalDepositedUsd: number | null;
  complete: boolean;
  syncedToBlock: string | null;
  depositCount: number | null;
  /** Deployment block the scan started from, so a reader can judge the gap. */
  fromBlock: string | null;
}

export function depositTotal(scan: DepositScan | null, assetDecimals: number): DepositTotal {
  if (!scan) return { totalDepositedUsd: null, complete: false, syncedToBlock: null, depositCount: null, fromBlock: null };
  return {
    totalDepositedUsd: scan.complete
      ? Number(formatUnits(BigInt(scan.depositedRaw), assetDecimals))
      : null,
    complete: scan.complete,
    syncedToBlock: scan.syncedTo,
    depositCount: scan.complete ? scan.depositCount : null,
    fromBlock: scan.fromBlock,
  };
}

/**
 * One bounded pass. Chunks are applied as a whole window so the cursor never passes a chunk whose
 * request failed, which would silently drop the deposits in it.
 */
export async function collectDeposits(scope: string, vault: Address): Promise<void> {
  const deployment = getDeployment(env.CHAIN_ID);
  if (!deployment) throw new Error("no deployment for this chain");
  const start = BigInt(deployment.deployedAtBlock);
  const existing = await readDepositScan(scope);
  // A redeployed vault, or a different deployment record, must not inherit another vault's sum.
  const scan: DepositScan =
    existing && existing.fromBlock === start.toString()
      ? existing
      : {
          _id: `deposits:${scope}`,
          scope,
          fromBlock: start.toString(),
          syncedTo: (start - 1n).toString(),
          depositedRaw: "0",
          depositCount: 0,
          complete: false,
        };

  const head = await publicClient.getBlockNumber();
  const ceiling = (() => {
    const budget = BigInt(scan.syncedTo) + BigInt(env.ACCOUNTING_DEPOSIT_BLOCKS_PER_TICK);
    return budget < head ? budget : head;
  })();
  let syncedTo = BigInt(scan.syncedTo);
  let deposited = BigInt(scan.depositedRaw);
  let count = scan.depositCount;

  while (syncedTo < ceiling) {
    const ranges: [bigint, bigint][] = [];
    for (let i = 0; i < CONCURRENCY && syncedTo + BigInt(i) * CHUNK < ceiling; i++) {
      const from = syncedTo + 1n + BigInt(i) * CHUNK;
      const to = from + CHUNK - 1n > ceiling ? ceiling : from + CHUNK - 1n;
      ranges.push([from, to]);
    }
    const batches = await Promise.all(ranges.map(([f, t]) => depositsIn(vault, f, t)));
    for (const log of batches.flat()) {
      deposited += log.args.assets ?? 0n;
      count += 1;
    }
    syncedTo = ranges[ranges.length - 1]![1];
  }

  await saveDepositScan({
    ...scan,
    syncedTo: syncedTo.toString(),
    depositedRaw: deposited.toString(),
    depositCount: count,
    complete: syncedTo >= head,
  });
}
