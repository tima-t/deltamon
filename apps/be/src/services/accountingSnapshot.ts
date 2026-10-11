import { type Address, erc20Abi, formatUnits } from "viem";
import {
  deltaMonVaultAbi,
  VaultAccountingSnapshotSchema,
  type VaultAccountingSnapshot,
} from "@deltamon/shared";
import { publicClient } from "../chain.js";
import { env } from "../config.js";

/** Current state at one pinned block. No validator reward, archive-state or historical RPC reads. */
export async function captureAccountingSnapshot(vault: Address): Promise<VaultAccountingSnapshot> {
  const block = await publicClient.getBlock();
  const c = { address: vault, abi: deltaMonVaultAbi } as const;
  const [
    totalAssets,
    grossAssets,
    totalSupply,
    shareDecimals,
    asset,
    ausd,
    totalMon,
    stakedMon,
    unstakingMon,
    monPrice,
    usdc,
    perpDeployed,
    perpEquity,
    accruedFees,
    pricePerShare,
    perpReportedAt,
    perpReportMaxAge,
  ] = await publicClient.multicall({
    blockNumber: block.number,
    allowFailure: false,
    contracts: [
      { ...c, functionName: "totalAssets" },
      { ...c, functionName: "grossAssets" },
      { ...c, functionName: "totalSupply" },
      { ...c, functionName: "decimals" },
      { ...c, functionName: "asset" },
      { ...c, functionName: "ausd" },
      { ...c, functionName: "totalMon" },
      { ...c, functionName: "stakedMon" },
      { ...c, functionName: "unstakingMon" },
      { ...c, functionName: "monPrice" },
      { ...c, functionName: "usdcBalance" },
      { ...c, functionName: "perpDeployed" },
      { ...c, functionName: "perpEquity" },
      { ...c, functionName: "accruedFees" },
      { ...c, functionName: "pricePerShare" },
      { ...c, functionName: "perpReportedAt" },
      { ...c, functionName: "perpReportMaxAge" },
    ],
  });
  const [assetDecimals, ausdDecimals, idleAusd] = await publicClient.multicall({
    blockNumber: block.number,
    allowFailure: false,
    contracts: [
      { address: asset, abi: erc20Abi, functionName: "decimals" },
      { address: ausd, abi: erc20Abi, functionName: "decimals" },
      { address: ausd, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
    ],
  });
  const usd = (value: bigint) => Number(formatUnits(value, assetDecimals));
  return VaultAccountingSnapshotSchema.parse({
    at: new Date(Number(block.timestamp) * 1000).toISOString(),
    recordedAt: new Date().toISOString(),
    chainId: env.CHAIN_ID,
    vault: vault.toLowerCase(),
    blockNumber: block.number.toString(),
    totalAssetsRaw: totalAssets.toString(),
    totalSupplyRaw: totalSupply.toString(),
    assetDecimals,
    shareDecimals,
    pricePerShareUsd: totalSupply === 0n ? null : usd(pricePerShare),
    netAssetsUsd: usd(totalAssets),
    grossAssetsUsd: usd(grossAssets),
    accruedFeesUsd: usd(accruedFees),
    idleUsdcUsd: usd(usdc),
    idleAusdUsd: Number(formatUnits(idleAusd, ausdDecimals)),
    monHeld: Number(formatUnits(totalMon, 18)),
    stakedMon: Number(formatUnits(stakedMon, 18)),
    unstakingMon: Number(formatUnits(unstakingMon, 18)),
    monPriceUsd: Number(formatUnits(monPrice, 18)),
    shortBackingCapitalUsd: usd(perpDeployed),
    shortEquityBookedUsd: usd(perpEquity),
    shortBookedAt:
      perpReportedAt === 0n ? null : new Date(Number(perpReportedAt) * 1000).toISOString(),
    shortBookFresh:
      perpDeployed === 0n ||
      (perpReportedAt > 0n &&
        perpReportedAt <= block.timestamp &&
        block.timestamp - perpReportedAt <= perpReportMaxAge),
    stakingApyBps: env.ACCOUNTING_STAKING_APY_BPS ?? null,
  });
}
