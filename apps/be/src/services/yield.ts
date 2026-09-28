import { type Address, formatUnits, parseAbi } from "viem";
import { deltaMonVaultAbi, type VaultYield } from "@deltamon/shared";
import { env } from "../config.js";
import { publicClient } from "../chain.js";
import { logger } from "../lib/logger.js";
import { findMarket } from "./perplAccounts.js";
import { vaultIndex } from "./vaultIndex.js";

/**
 * The vault's run-rate yield: staking rewards on the MON it holds plus funding on the short,
 * over the USDC depositors actually put in (the sum of their cost bases). Funding is a trailing
 * week, since a single print swings sign from one interval to the next; staking is as long a
 * window as the RPC keeps state for.
 *
 * Simple annualised, no compounding: rewards are not restaked automatically.
 */

const YEAR_SEC = 365 * 24 * 3600;
const WINDOW_SEC = 7 * 24 * 3600;
const STAKING = "0x0000000000000000000000000000000000001000" as const;
/** Monad's precompile scales accRewardPerToken by 1e36. */
const ACC_SCALE = 10n ** 36n;

const stakingAbi = parseAbi([
  "function getValidator(uint64) returns (address,uint64,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bytes,bytes)",
  "function getDelegator(uint64,address) returns (uint256,uint256,uint256,uint256,uint256,uint64,uint64)",
]);

function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let hit: { at: number; value: Promise<T> } | null = null;
  return () => {
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load();
    hit = { at: Date.now(), value };
    // A failure is not cached: the next caller tries again.
    value.catch(() => (hit = null));
    return value;
  };
}

const accRewardPerToken = async (validatorId: bigint, blockNumber?: bigint) =>
  (
    await publicClient.simulateContract({
      address: STAKING,
      abi: stakingAbi,
      functionName: "getValidator",
      args: [validatorId],
      blockNumber,
    })
  ).result[3];

/** A block roughly `days` back, found from the average block time over the last 100k blocks. */
const blockTime = cached(3_600_000, async () => {
  const head = await publicClient.getBlock();
  const probe = await publicClient.getBlock({ blockNumber: head.number - 100_000n });
  return Number(head.timestamp - probe.timestamp) / 100_000;
});

async function blocksAround(days: number) {
  const head = await publicClient.getBlock();
  const back = BigInt(Math.round((days * 86_400) / (await blockTime())));
  const start = await publicClient.getBlock({ blockNumber: head.number - back });
  return { head, start };
}

/**
 * The public RPC only keeps a few days of state for eth_call, so the window shrinks until a
 * historical read succeeds. Delegator rewards accrue evenly, so a day already reads true.
 */
const STAKING_WINDOWS_DAYS = [7, 3, 1];

const aprCache = new Map<bigint, () => Promise<number>>();

/** Trailing APR a delegator of this validator earned, net of the validator's commission. */
function stakingApr(validatorId: bigint): Promise<number> {
  let fn = aprCache.get(validatorId);
  if (!fn) {
    fn = cached(3_600_000, async () => {
      let lastErr: unknown;
      for (const days of STAKING_WINDOWS_DAYS) {
        try {
          const { head, start } = await blocksAround(days);
          const [now, then] = await Promise.all([
            accRewardPerToken(validatorId, head.number),
            accRewardPerToken(validatorId, start.number),
          ]);
          const perMon = Number(((now - then) * 10n ** 18n) / ACC_SCALE) / 1e18;
          return (perMon * YEAR_SEC) / Number(head.timestamp - start.timestamp);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    });
    aprCache.set(validatorId, fn);
  }
  return fn();
}

/** Trailing funding a short on Perpl's MON market was paid, annualised, as a fraction of notional. */
const fundingApr = cached(900_000, async () => {
  const market = await findMarket("MON");
  if (!market?.fundingIntervalSec) throw new Error("no MON market");
  const to = Date.now();
  const res = await fetch(
    `${env.PERPL_API_URL}/v1/market-data/${market.id}/funding/${to - WINDOW_SEC * 1000}-${to}`,
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) throw new Error(`Perpl funding ${res.status}`);
  const { d } = (await res.json()) as { d?: { rate?: unknown }[] };
  const rates = (d ?? []).map((e) => e.rate).filter((r): r is number => typeof r === "number");
  if (rates.length === 0) throw new Error("no funding history");
  // Rates are micros per interval. Positive means longs pay shorts, which is what the vault is.
  const perInterval = rates.reduce((a, b) => a + b, 0) / rates.length / 1e6;
  return (perInterval * YEAR_SEC) / market.fundingIntervalSec;
});

/** Weighted staking APR over the validators the vault delegates to, by the MON with each. */
async function vaultStakingApr(vault: Address, validators: bigint[]): Promise<number | null> {
  const rows = await Promise.all(
    validators.map(async (id) => {
      const { result } = await publicClient.simulateContract({
        address: STAKING,
        abi: stakingAbi,
        functionName: "getDelegator",
        args: [id, vault],
      });
      // Active stake, plus what activates at the next epoch or the one after.
      const weight = result[0] + result[3] + result[4];
      return { id, weight };
    }),
  );
  const total = rows.reduce((a, r) => a + r.weight, 0n);
  if (total === 0n) return null;
  let apr = 0;
  for (const r of rows) {
    if (r.weight === 0n) continue;
    apr += (await stakingApr(r.id)) * (Number(r.weight) / Number(total));
  }
  return apr;
}

async function principalUsd(vault: Address, holders: Address[], decimals: number) {
  if (holders.length === 0) return 0;
  const bases = await publicClient.multicall({
    allowFailure: false,
    contracts: holders.map((h) => ({
      address: vault,
      abi: deltaMonVaultAbi,
      functionName: "costBasis" as const,
      args: [h] as const,
    })),
  });
  return Number(formatUnits(bases.reduce((a, b) => a + b, 0n), decimals));
}

const toBps = (x: number | null) => (x === null ? null : Math.round(x * 10_000));

export async function readVaultYield(
  vault: Address,
  opts: { stakedMon: bigint; monPriceUsd: number; shortNotionalUsd: number | null; assetDecimals: number },
): Promise<VaultYield | null> {
  const index = await vaultIndex(vault);
  if (!index) return null;
  const settle = <T>(p: Promise<T>, what: string) =>
    p.catch((err) => {
      logger.debug({ err, what }, "yield input unavailable");
      return null;
    });

  const [stakingRate, fundingRate, principal] = await Promise.all([
    index.complete ? settle(vaultStakingApr(vault, [...index.validators]), "staking") : null,
    settle(fundingApr(), "funding"),
    index.complete ? settle(principalUsd(vault, [...index.holders], opts.assetDecimals), "principal") : null,
  ]);

  const stakedUsd = Number(formatUnits(opts.stakedMon, 18)) * opts.monPriceUsd;
  const stakingUsdPerYear = stakingRate === null ? null : stakingRate * stakedUsd;
  const fundingUsdPerYear =
    fundingRate === null || opts.shortNotionalUsd === null ? null : fundingRate * opts.shortNotionalUsd;
  const apy =
    principal && principal > 0 && stakingUsdPerYear !== null && fundingUsdPerYear !== null
      ? (stakingUsdPerYear + fundingUsdPerYear) / principal
      : null;

  return {
    apyBps: toBps(apy),
    stakingAprBps: toBps(stakingRate),
    stakedUsd,
    stakingUsdPerYear,
    fundingAprBps: toBps(fundingRate),
    fundingUsdPerYear,
    principalUsd: principal,
    windowDays: WINDOW_SEC / 86_400,
  };
}
