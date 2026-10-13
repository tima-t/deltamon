import { z } from "zod";

/** A recorded contract valuation; virtual staking income never modifies this NAV. */
export const VaultAccountingSnapshotSchema = z.object({
  at: z.string(),
  recordedAt: z.string(),
  chainId: z.number().int(),
  vault: z.string(),
  blockNumber: z.string(),
  totalAssetsRaw: z.string(),
  totalSupplyRaw: z.string(),
  assetDecimals: z.number().int(),
  shareDecimals: z.number().int(),
  pricePerShareUsd: z.number().nullable(),
  netAssetsUsd: z.number(),
  grossAssetsUsd: z.number(),
  accruedFeesUsd: z.number(),
  idleUsdcUsd: z.number(),
  idleAusdUsd: z.number(),
  monHeld: z.number(),
  stakedMon: z.number(),
  unstakingMon: z.number(),
  monPriceUsd: z.number(),
  shortBackingCapitalUsd: z.number(),
  shortEquityBookedUsd: z.number(),
  shortBookedAt: z.string().nullable(),
  shortBookFresh: z.boolean(),
  /** Rate recorded with this observation, never replaced with today's setting. */
  stakingApyBps: z.number().nullable(),
});
export type VaultAccountingSnapshot = z.infer<typeof VaultAccountingSnapshotSchema>;

export const AccountingDailySchema = z.object({
  date: z.string(),
  pricePerShareUsd: z.number().nullable(),
  /** Contract book return, not a personalized return after redemption fees. */
  vaultReturnPct: z.number().nullable(),
  returnSegment: z.number().int().nullable(),
  snapshotAt: z.string().nullable(),
  shortBookFresh: z.boolean().nullable(),
  /** Settled on this day. Account funding and position funding are reconciled, not added twice. */
  fundingSettledUsd: z.number().nullable(),
  /** Observed movement in settled + open accrued funding; available only during collected coverage. */
  fundingObservedUsd: z.number().nullable(),
  fundingObservedSeconds: z.number(),
  tradingFeesUsd: z.number().nullable(),
  realisedTradingPnlUsd: z.number().nullable(),
  stakingEstimatedMon: z.number().nullable(),
  stakingEstimatedUsd: z.number().nullable(),
  stakingCoveredSeconds: z.number(),
  capitalInUseUsd: z.number().nullable(),
  capitalCoveredSeconds: z.number(),
  /** Available for covered intervals, not a full-vault return. */
  strategyIncomeEstimatedUsd: z.number().nullable(),
  partial: z.boolean(),
});
export type AccountingDaily = z.infer<typeof AccountingDailySchema>;

export const VaultAccountingHistorySchema = z.object({
  vault: z.string().nullable(),
  chainId: z.number().int(),
  from: z.string(),
  to: z.string(),
  status: z.enum(["not_configured", "collecting", "available"]),
  latest: VaultAccountingSnapshotSchema.nullable(),
  /** Gross asset composition includes idle AUSD; accrued fees are a separate liability. */
  composition: z
    .object({
      at: z.string(),
      basis: z.literal("gross_assets"),
      idleUsdcUsd: z.number(),
      idleAusdUsd: z.number(),
      monHoldingsUsd: z.number(),
      shortEquityBookedUsd: z.number(),
      accruedFeesUsd: z.number(),
      shortBookedAt: z.string().nullable(),
      shortBookFresh: z.boolean(),
    })
    .nullable(),
  /**
   * USDC ever paid into the vault, from its own Deposit logs. The denominator for strategy
   * return. Null while the log scan is still catching up: a partial sum is not a total.
   */
  deposits: z
    .object({
      totalDepositedUsd: z.number().nullable(),
      complete: z.boolean(),
      syncedToBlock: z.string().nullable(),
      depositCount: z.number().int().nullable(),
      fromBlock: z.string().nullable(),
    })
    // Defaulted, not required: the two services do not deploy atomically, and a frontend that
    // rejected an older backend's payload would blank the whole record rather than one reading.
    .default({
      totalDepositedUsd: null,
      complete: false,
      syncedToBlock: null,
      depositCount: null,
      fromBlock: null,
    }),
  perpl: z.object({
    accountId: z.number().nullable(),
    marketId: z.number().nullable(),
    historyFrom: z.string().nullable(),
    historyComplete: z.boolean(),
    syncedThrough: z.string().nullable(),
  }),
  sources: z.object({
    vaultReturn: z.literal("contract_book_value"),
    fundingSettled: z.literal("perpl_account_and_position_events"),
    fundingObserved: z.literal("perpl_settled_plus_open_accrual"),
    tradingFees: z.literal("perpl_fills"),
    staking: z.literal("estimated_from_recorded_balance_and_assumed_apy"),
    /** Strategy return is income over contributed capital, not a change in book value. */
    strategyReturn: z.literal("strategy_income_over_total_deposited").optional(),
  }),
  daily: z.array(AccountingDailySchema),
});
export type VaultAccountingHistory = z.infer<typeof VaultAccountingHistorySchema>;
