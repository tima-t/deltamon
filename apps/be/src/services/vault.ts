import { type Address, erc20Abi, formatUnits } from "viem";
import { sdMonVaultAbi, type VaultStats } from "@deltamon/shared";
import { env } from "../config.js";
import { publicClient } from "../chain.js";

const DEMO_MON_PRICE = 0.02643;

export function demoVaultStats(): VaultStats {
  const now = new Date();
  const usdc = 51_380;
  const mon = 2_915_530;
  const monValue = mon * DEMO_MON_PRICE;
  const tvl = usdc + monValue;
  const supply = 126_800;
  return {
    source: "demo",
    chainId: env.CHAIN_ID,
    vault: null,
    asset: "USDC",
    assetDecimals: 6,
    tvlUsd: tvl,
    totalAssets: String(Math.round(tvl * 1e6)),
    depositCapUsd: 250_000,
    minDepositUsd: 10,
    paused: false,
    shareToken: {
      symbol: "sdMON",
      decimals: 18,
      totalSupply: `${supply}000000000000000000`,
      pricePerShare: tvl / supply,
    },
    allocation: {
      usdc: { balance: String(usdc * 1e6), valueUsd: usdc },
      mon: { balance: `${mon}000000000000000000`, valueUsd: monValue, priceUsd: DEMO_MON_PRICE },
      monShareBps: Math.round((monValue / tvl) * 10_000),
      targetMonBps: 6_000,
      driftBps: Math.round((monValue / tvl) * 10_000) - 6_000,
      rebalanceThresholdBps: 500,
    },
    lastRebalanceAt: new Date(now.getTime() - 37 * 60_000).toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function readVaultStats(vault: Address): Promise<VaultStats> {
  const c = { address: vault, abi: sdMonVaultAbi } as const;
  const [
    totalAssets,
    totalSupply,
    shareDecimals,
    symbol,
    asset,
    usdcBalance,
    monBalance,
    monPrice,
    monShareBps,
    targetMonBps,
    driftBps,
    thresholdBps,
    paused,
    depositCap,
    minDeposit,
    lastRebalanceAt,
    pricePerShare,
  ] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { ...c, functionName: "totalAssets" },
      { ...c, functionName: "totalSupply" },
      { ...c, functionName: "decimals" },
      { ...c, functionName: "symbol" },
      { ...c, functionName: "asset" },
      { ...c, functionName: "usdcBalance" },
      { ...c, functionName: "monBalance" },
      { ...c, functionName: "monPrice" },
      { ...c, functionName: "monShareBps" },
      { ...c, functionName: "targetMonBps" },
      { ...c, functionName: "allocationDriftBps" },
      { ...c, functionName: "rebalanceThresholdBps" },
      { ...c, functionName: "paused" },
      { ...c, functionName: "depositCap" },
      { ...c, functionName: "minDeposit" },
      { ...c, functionName: "lastRebalanceAt" },
      { ...c, functionName: "pricePerShare" },
    ],
  });

  const [assetSymbol, assetDecimals] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: asset, abi: erc20Abi, functionName: "symbol" },
      { address: asset, abi: erc20Abi, functionName: "decimals" },
    ],
  });

  const usdcValue = Number(formatUnits(usdcBalance, assetDecimals));
  const priceUsd = Number(formatUnits(monPrice, 18));
  const monValue = Number(formatUnits(monBalance, 18)) * priceUsd;

  return {
    source: "onchain",
    chainId: env.CHAIN_ID,
    vault,
    asset: assetSymbol,
    assetDecimals,
    tvlUsd: Number(formatUnits(totalAssets, assetDecimals)),
    totalAssets: totalAssets.toString(),
    depositCapUsd: Number(formatUnits(depositCap, assetDecimals)),
    minDepositUsd: Number(formatUnits(minDeposit, assetDecimals)),
    paused,
    shareToken: {
      symbol,
      decimals: shareDecimals,
      totalSupply: totalSupply.toString(),
      pricePerShare: Number(formatUnits(pricePerShare, assetDecimals)),
    },
    allocation: {
      usdc: { balance: usdcBalance.toString(), valueUsd: usdcValue },
      mon: { balance: monBalance.toString(), valueUsd: monValue, priceUsd },
      monShareBps: Number(monShareBps),
      targetMonBps: Number(targetMonBps),
      driftBps: Number(driftBps),
      rebalanceThresholdBps: Number(thresholdBps),
    },
    lastRebalanceAt:
      lastRebalanceAt === 0n ? null : new Date(Number(lastRebalanceAt) * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function getVaultStats(): Promise<VaultStats> {
  if (!env.VAULT_ADDRESS) return demoVaultStats();
  return readVaultStats(env.VAULT_ADDRESS as Address);
}
