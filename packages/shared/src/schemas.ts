import { z } from "zod";

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte hex address");

export const AllocationSchema = z.object({
  usdc: z.object({ balance: z.string(), valueUsd: z.number() }),
  mon: z.object({ balance: z.string(), valueUsd: z.number(), priceUsd: z.number() }),
  /** Share of vault value held as MON, bps. */
  monShareBps: z.number().int(),
  targetMonBps: z.number().int(),
  /** monShareBps − targetMonBps. Positive = too much MON. */
  driftBps: z.number().int(),
  rebalanceThresholdBps: z.number().int(),
});
export type Allocation = z.infer<typeof AllocationSchema>;

export const ShareTokenSchema = z.object({
  symbol: z.string(),
  decimals: z.number().int(),
  /** Raw integer as decimal string. */
  totalSupply: z.string(),
  /** USDC per whole share. */
  pricePerShare: z.number(),
});
export type ShareToken = z.infer<typeof ShareTokenSchema>;

export const VaultStatsSchema = z.object({
  source: z.enum(["demo", "onchain"]),
  chainId: z.number().int(),
  vault: hexAddress.nullable(),
  asset: z.string(),
  assetDecimals: z.number().int(),
  tvlUsd: z.number(),
  /** Raw integer as decimal string. */
  totalAssets: z.string(),
  depositCapUsd: z.number().nullable(),
  minDepositUsd: z.number(),
  paused: z.boolean(),
  shareToken: ShareTokenSchema,
  allocation: AllocationSchema,
  lastRebalanceAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type VaultStats = z.infer<typeof VaultStatsSchema>;

export const FundingSnapshotSchema = z.object({
  venue: z.string(),
  market: z.string(),
  fundingRateHourly: z.number().nullable(),
  fundingRateAnnualized: z.number().nullable(),
  markPrice: z.number().nullable(),
  updatedAt: z.string(),
});
export type FundingSnapshot = z.infer<typeof FundingSnapshotSchema>;

export const PriceSchema = z.object({
  symbol: z.string(),
  feedId: z.string(),
  price: z.number(),
  conf: z.number(),
  publishTime: z.number().int(),
});
export type Price = z.infer<typeof PriceSchema>;

export const KeeperStatusSchema = z.object({
  enabled: z.boolean(),
  dryRun: z.boolean(),
  lastRunAt: z.string().nullable(),
  lastAction: z.string().nullable(),
  lastError: z.string().nullable(),
});
export type KeeperStatus = z.infer<typeof KeeperStatusSchema>;

export const HealthSchema = z.object({
  status: z.literal("ok"),
  chainId: z.number().int(),
  blockNumber: z.string().nullable(),
  keeper: KeeperStatusSchema,
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;
