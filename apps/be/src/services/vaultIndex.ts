import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, getAddress } from "viem";
import { deltaMonVaultAbi, getDeployment } from "@deltamon/shared";
import { env } from "../config.js";
import { publicClient } from "../chain.js";
import { logger } from "../lib/logger.js";

/**
 * Who has ever held sdMON, and which validators the vault has staked with. Neither is readable
 * from the vault directly: principal lives in a per-holder `costBasis` mapping and stake is only
 * split by validator inside the precompile. Both come from the vault's own logs.
 *
 * Monad's public RPC answers eth_getLogs over 100 blocks at most, so the first sync is thousands
 * of requests. Progress is kept in apps/be/.cache so that happens once per vault, not per restart.
 */

const CHUNK = 100n;
const CONCURRENCY = 8;
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../.cache");

export interface VaultIndex {
  /** Last block scanned, inclusive. */
  syncedTo: bigint;
  holders: Set<Address>;
  validators: Set<bigint>;
  /** True once the scan has reached the chain head at least once. */
  complete: boolean;
}

const indexes = new Map<Address, VaultIndex>();
const running = new Map<Address, Promise<void>>();

const cachePath = (vault: Address) => join(CACHE_DIR, `vault-index-${env.CHAIN_ID}-${vault}.json`);

async function load(vault: Address, fromBlock: bigint): Promise<VaultIndex> {
  try {
    const raw = JSON.parse(await readFile(cachePath(vault), "utf8")) as {
      syncedTo: string;
      holders: string[];
      validators: string[];
      complete: boolean;
    };
    return {
      syncedTo: BigInt(raw.syncedTo),
      holders: new Set(raw.holders.map((a) => getAddress(a))),
      validators: new Set(raw.validators.map(BigInt)),
      complete: raw.complete,
    };
  } catch {
    return { syncedTo: fromBlock - 1n, holders: new Set(), validators: new Set(), complete: false };
  }
}

async function save(vault: Address, index: VaultIndex): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    cachePath(vault),
    JSON.stringify({
      syncedTo: index.syncedTo.toString(),
      holders: [...index.holders],
      validators: [...index.validators].map(String),
      complete: index.complete,
    }),
  );
}

async function logsIn(vault: Address, fromBlock: bigint, toBlock: bigint) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await publicClient.getContractEvents({
        address: vault,
        abi: deltaMonVaultAbi,
        eventName: undefined,
        fromBlock,
        toBlock,
      });
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

async function sync(vault: Address, index: VaultIndex): Promise<void> {
  const head = await publicClient.getBlockNumber();
  let lastSave = Date.now();
  while (index.syncedTo < head) {
    // A window of chunks at a time, applied only once the whole window is in, so `syncedTo`
    // never runs ahead of a chunk that failed.
    const ranges: [bigint, bigint][] = [];
    for (let i = 0; i < CONCURRENCY && index.syncedTo + BigInt(i) * CHUNK < head; i++) {
      const from = index.syncedTo + 1n + BigInt(i) * CHUNK;
      const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
      ranges.push([from, to]);
    }
    const batches = await Promise.all(ranges.map(([f, t]) => logsIn(vault, f, t)));
    for (const log of batches.flat()) {
      if (log.eventName === "Transfer") {
        const { to } = log.args as { to: Address };
        if (to !== "0x0000000000000000000000000000000000000000") index.holders.add(getAddress(to));
      } else if (log.eventName === "Staked") {
        index.validators.add(BigInt((log.args as { validatorId: bigint }).validatorId));
      }
    }
    index.syncedTo = ranges[ranges.length - 1]![1];
    if (Date.now() - lastSave > 10_000) {
      await save(vault, index);
      lastSave = Date.now();
    }
  }
  index.complete = true;
  await save(vault, index);
}

/**
 * The index as far as it has got, kicking off a catch-up scan in the background. Callers treat an
 * incomplete index as unknown rather than as a partial answer.
 */
export async function vaultIndex(vault: Address): Promise<VaultIndex | null> {
  const deployment = getDeployment(env.CHAIN_ID);
  if (!deployment || getAddress(deployment.vault) !== getAddress(vault)) return null;
  let index = indexes.get(vault);
  if (!index) {
    index = await load(vault, BigInt(deployment.deployedAtBlock));
    indexes.set(vault, index);
  }
  if (!running.has(vault)) {
    const started = Date.now();
    const job = sync(vault, index)
      .then(() => {
        if (Date.now() - started > 5_000) logger.info({ syncedTo: String(index.syncedTo) }, "vault index synced");
      })
      .catch((err) => logger.warn({ err }, "vault index sync failed"))
      .finally(() => running.delete(vault));
    running.set(vault, job);
  }
  return index;
}
