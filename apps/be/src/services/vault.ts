import { type Address, formatUnits } from "viem";
import { deltaVaultAbi, type VaultStats } from "@deltamon/shared";
import { env } from "../config.js";
import { publicClient } from "../chain.js";

/**
 * APY inputs the keeper cannot yet read on-chain. Replace with realized numbers
 * once the strategy has enough history (see docs/STRATEGY.md).
 */
const APY_ESTIMATE = { staking: 9.1, funding: 6.8, lending: 0, costs: -0.7 } as const;

function netApy(a: { staking: number; funding: number; lending: number; costs: number }) {
  return Number((a.staking + a.funding + a.lending + a.costs).toFixed(2));
}

export function demoVaultStats(): VaultStats {
  const now = new Date();
  return {
    source: "demo",
    chainId: env.CHAIN_ID,
    vault: null,
    asset: "USDC",
    assetDecimals: 6,
    tvlUsd: 2_418_300,
    totalAssets: "2418300000000",
    totalSupply: "2301400000000",
    pricePerShare: 1.0508,
    depositCapUsd: 5_000_000,
    paused: false,
    apy: { ...APY_ESTIMATE, net: netApy(APY_ESTIMATE), source: "estimate" },
    netDeltaBps: 40,
    hedgeRatioBps: 9_960,
    legs: {
      long: { venue: "aPriori", asset: "aprMON", valueUsd: 1_204_300 },
      short: { venue: "Perpl", asset: "MON-PERP", valueUsd: 1_199_500 },
    },
    lastRebalanceAt: new Date(now.getTime() - 12 * 60_000).toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function readVaultStats(vault: Address): Promise<VaultStats> {
  const contract = { address: vault, abi: deltaVaultAbi } as const;
  const [totalAssets, totalSupply, decimals, netDeltaBps, pricePerShare, paused, depositCap] =
    await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { ...contract, functionName: "totalAssets" },
        { ...contract, functionName: "totalSupply" },
        { ...contract, functionName: "decimals" },
        { ...contract, functionName: "netDeltaBps" },
        { ...contract, functionName: "pricePerShare" },
        { ...contract, functionName: "paused" },
        { ...contract, functionName: "depositCap" },
      ],
    });

  const tvlUsd = Number(formatUnits(totalAssets, decimals));
  const delta = Number(netDeltaBps);
  const hedgeRatioBps = 10_000 - Math.abs(delta);
  // Leg values are exposed by the strategy; until the strategy ABI is wired here we
  // derive them from delta so the UI stays consistent with on-chain state.
  const longUsd = tvlUsd / 2;
  const shortUsd = longUsd * (hedgeRatioBps / 10_000);

  return {
    source: "onchain",
    chainId: env.CHAIN_ID,
    vault,
    asset: "USDC",
    assetDecimals: decimals,
    tvlUsd,
    totalAssets: totalAssets.toString(),
    totalSupply: totalSupply.toString(),
    pricePerShare: Number(pricePerShare) / 1e18,
    depositCapUsd: Number(formatUnits(depositCap, decimals)),
    paused,
    apy: { ...APY_ESTIMATE, net: netApy(APY_ESTIMATE), source: "estimate" },
    netDeltaBps: delta,
    hedgeRatioBps,
    legs: {
      long: { venue: "aPriori", asset: "aprMON", valueUsd: longUsd },
      short: { venue: "Perpl", asset: "MON-PERP", valueUsd: shortUsd },
    },
    lastRebalanceAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function getVaultStats(): Promise<VaultStats> {
  if (!env.VAULT_ADDRESS) return demoVaultStats();
  return readVaultStats(env.VAULT_ADDRESS as Address);
}
