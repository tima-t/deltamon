import { z } from "zod";

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 20-byte hex address");

export const ApyBreakdownSchema = z.object({
  /** All values are percentages, e.g. 15.2 means 15.2 % APY. */
  net: z.number(),
  staking: z.number(),
  funding: z.number(),
  lending: z.number(),
  costs: z.number(),
  source: z.enum(["estimate", "realized"]),
});
export type ApyBreakdown = z.infer<typeof ApyBreakdownSchema>;

export const LegSchema = z.object({
  venue: z.string(),
  asset: z.string(),
  valueUsd: z.number(),
});
export type Leg = z.infer<typeof LegSchema>;

export const VaultStatsSchema = z.object({
  source: z.enum(["demo", "onchain"]),
  chainId: z.number().int(),
  vault: hexAddress.nullable(),
  asset: z.string(),
  assetDecimals: z.number().int(),
  tvlUsd: z.number(),
  /** Raw integers as decimal strings to avoid float loss. */
  totalAssets: z.string(),
  totalSupply: z.string(),
  pricePerShare: z.number(),
  depositCapUsd: z.number().nullable(),
  paused: z.boolean(),
  apy: ApyBreakdownSchema,
  netDeltaBps: z.number().int(),
  hedgeRatioBps: z.number().int(),
  legs: z.object({ long: LegSchema, short: LegSchema }),
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
