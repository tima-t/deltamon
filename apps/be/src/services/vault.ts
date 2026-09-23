import { type Address, erc20Abi, formatUnits } from "viem";
import { deltaMonVaultAbi, type VaultStats } from "@deltamon/shared";
import { env } from "../config.js";
import { publicClient } from "../chain.js";
import { fetchPerpBook } from "./perpBook.js";
import { assessHedge } from "./hedge.js";

const DEMO_MON_PRICE = 0.02643;

export function demoVaultStats(): VaultStats {
  const now = new Date();
  const usdc = 11_380;
  const managerCapitalUsd = 40_000;
  const mon = 2_915_530;
  const monValue = mon * DEMO_MON_PRICE;
  const tvl = usdc + monValue + managerCapitalUsd;
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
      targetMonBps: Math.round((monValue / tvl) * 10_000),
      driftBps: 0,
      rebalanceThresholdBps: 0,
    },
    hedge: {
      longExposureUsd: monValue,
      shortExposureUsd: monValue,
      managerCapitalUsd,
      managerEquityUsd: managerCapitalUsd,
      netDeltaBps: 0,
      reportAsOf: now.toISOString(),
      dataStatus: "fresh",
    },
    lastRebalanceAt: null,
    updatedAt: now.toISOString(),
  };
}

export async function readVaultStats(vault: Address): Promise<VaultStats> {
  const c = { address: vault, abi: deltaMonVaultAbi } as const;
  const [
    totalAssets,
    totalSupply,
    shareDecimals,
    symbol,
    asset,
    usdcBalance,
    totalMon,
    monPrice,
    paused,
    depositCap,
    minDeposit,
    pricePerShare,
    perpDeployed,
    perpEquity,
  ] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { ...c, functionName: "totalAssets" },
      { ...c, functionName: "totalSupply" },
      { ...c, functionName: "decimals" },
      { ...c, functionName: "symbol" },
      { ...c, functionName: "asset" },
      { ...c, functionName: "usdcBalance" },
      { ...c, functionName: "totalMon" },
      { ...c, functionName: "monPrice" },
      { ...c, functionName: "paused" },
      { ...c, functionName: "depositCap" },
      { ...c, functionName: "minDeposit" },
      { ...c, functionName: "pricePerShare" },
      { ...c, functionName: "perpDeployed" },
      { ...c, functionName: "perpEquity" },
    ],
  });

  const [assetSymbol, assetDecimals] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: asset, abi: erc20Abi, functionName: "symbol" },
      { address: asset, abi: erc20Abi, functionName: "decimals" },
    ],
  });

  const tvlUsd = Number(formatUnits(totalAssets, assetDecimals));
  const usdcValue = Number(formatUnits(usdcBalance, assetDecimals));
  const priceUsd = Number(formatUnits(monPrice, 18));
  // Wrapped, native, staked and unbonding MON alike.
  const monValue = Number(formatUnits(totalMon, 18)) * priceUsd;
  const monShareBps = tvlUsd > 0 ? Math.round((monValue / tvlUsd) * 10_000) : 0;
  const book = env.PERP_BOOK_URL
    ? await fetchPerpBook(env.PERP_BOOK_URL, 1_500).catch(() => null)
    : null;

  return {
    source: "onchain",
    chainId: env.CHAIN_ID,
    vault,
    asset: assetSymbol,
    assetDecimals,
    tvlUsd,
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
      mon: { balance: totalMon.toString(), valueUsd: monValue, priceUsd },
      monShareBps,
      // Legacy allocation fields remain in the shared schema. DeltaMonVault has no fixed
      // allocation target, so never publish a fictitious 60/40 drift for this vault.
      targetMonBps: monShareBps,
      driftBps: 0,
      rebalanceThresholdBps: 0,
    },
    hedge: assessHedge(
      monValue,
      tvlUsd,
      book,
      Number(formatUnits(perpDeployed, assetDecimals)),
      Number(formatUnits(perpEquity, assetDecimals)),
    ),
    lastRebalanceAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export async function getVaultStats(): Promise<VaultStats> {
  if (!env.VAULT_ADDRESS) return demoVaultStats();
  return readVaultStats(env.VAULT_ADDRESS as Address);
}
