import type { MarketConfig } from "./perplOrders.js";

/**
 * What a Perpl position actually means, in human units.
 *
 * Perpl publishes no liquidation price, so it is derived here from the position's own collateral
 * and the market's maintenance margin. Everything else is a straight unscaling of what the socket
 * reports, and anything that cannot be computed is null rather than a plausible-looking zero.
 */

/** mt 26 `sd`. */
export const SIDE = { long: 1, short: 2 } as const;

export interface RawPosition {
  mkt?: unknown;
  pid?: unknown;
  sd?: unknown;
  c?: unknown;
  ep?: unknown;
  s?: unknown;
  efs?: unknown;
  lv?: unknown;
  fnd?: unknown;
  dpnl?: unknown;
  fee?: unknown;
}

export interface PositionView {
  positionId: string | null;
  market: number | null;
  marketName: string | null;
  side: "long" | "short" | null;
  /** Whole units of the market's size_units. */
  size: number | null;
  entryPrice: number | null;
  markPrice: number | null;
  /** Size at the mark, in collateral units. */
  notionalUsd: number | null;
  collateralUsd: number | null;
  leverage: number | null;
  unrealisedPnlUsd: number | null;
  /** Funding already settled into the position. */
  realisedFundingUsd: number | null;
  /** Funding accrued since entry but not yet settled. */
  unrealisedFundingUsd: number | null;
  /** Realised plus unrealised: the whole funding story for this position. */
  fundingAccruedUsd: number | null;
  /** Per funding interval, as a fraction. */
  fundingRate: number | null;
  /** The same rate over a year, for comparison with a yield. */
  fundingRateAnnualised: number | null;
  fundingIntervalSec: number | null;
  /** When the next funding is expected to settle, unix ms. */
  nextFundingAtMs: number | null;
  /** Derived, not published by Perpl. Null when the inputs are missing. */
  liquidationPrice: number | null;
  /** How far the mark can move toward liquidation, as a fraction of the mark. */
  liquidationBuffer: number | null;
  /** The maintenance fraction used for the estimate, so the number can be checked. */
  maintenanceMargin: number | null;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const scaled = (v: unknown, decimals: number): number | null => {
  const n = num(v);
  return n === null ? null : n / 10 ** decimals;
};

/** Collateral and PnL are in the settlement token, which is USDC at six decimals. */
const USDC_DECIMALS = 6;

export function describePosition(raw: RawPosition, market: MarketConfig): PositionView {
  const size = scaled(raw.s, market.sizeDecimals);
  const entryPrice = scaled(raw.ep, market.priceDecimals);
  const markPrice =
    market.markPrice === null ? null : market.markPrice / 10 ** market.priceDecimals;
  const collateralUsd = scaled(raw.c, USDC_DECIMALS);
  const sd = num(raw.sd);
  const side = sd === SIDE.long ? "long" : sd === SIDE.short ? "short" : null;
  const leverage = num(raw.lv) === null ? null : (num(raw.lv) as number) / 100;

  const notionalUsd = size !== null && markPrice !== null ? size * markPrice : null;

  // A short gains as the price falls, a long as it rises.
  const unrealisedPnlUsd =
    size !== null && entryPrice !== null && markPrice !== null && side !== null
      ? side === "short"
        ? size * (entryPrice - markPrice)
        : size * (markPrice - entryPrice)
      : null;

  // Funding accrued is the movement in the market's cumulative sum since this position entered.
  const entryFundingSum = num(raw.efs);
  const unrealisedFundingUsd =
    market.fundingSum !== null && entryFundingSum !== null && size !== null
      ? ((market.fundingSum - entryFundingSum) * size) /
        10 ** (market.priceDecimals + market.fundingSumScalingExp)
      : null;

  const { liquidationPrice, liquidationBuffer, maintenanceMargin } = liquidation(
    side,
    size,
    entryPrice,
    collateralUsd,
    markPrice,
    market.maintenanceMargin,
  );

  const realisedFundingUsd = scaled(raw.fnd, USDC_DECIMALS);
  const fundingAccruedUsd =
    realisedFundingUsd === null && unrealisedFundingUsd === null
      ? null
      : (realisedFundingUsd ?? 0) + (unrealisedFundingUsd ?? 0);

  // `funding.rate` is scaled by the market's price decimals, not a bare fraction. Checked against
  // the book: a sum delta of 27 (at 10^8 per unit size) on a 0.028056 mark is 9.6e-6 of notional,
  // and the rate field read 10, which is 1.0e-5 once divided by 10^6. Taken literally it would
  // have published a 12,000,000% annual rate.
  const fundingRate =
    market.fundingRate === null ? null : market.fundingRate / 10 ** market.priceDecimals;
  const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
  const fundingRateAnnualised =
    fundingRate !== null && market.fundingIntervalSec
      ? fundingRate * (SECONDS_PER_YEAR / market.fundingIntervalSec)
      : null;
  const nextFundingAtMs =
    market.fundingLastAtMs !== null && market.fundingIntervalSec
      ? market.fundingLastAtMs + market.fundingIntervalSec * 1000
      : null;

  return {
    positionId: raw.pid === undefined || raw.pid === null ? null : String(raw.pid),
    market: num(raw.mkt),
    marketName: market.name,
    side,
    size,
    entryPrice,
    markPrice,
    notionalUsd,
    collateralUsd,
    leverage,
    unrealisedPnlUsd,
    realisedFundingUsd,
    unrealisedFundingUsd,
    fundingAccruedUsd,
    fundingRate,
    fundingRateAnnualised,
    fundingIntervalSec: market.fundingIntervalSec,
    nextFundingAtMs,
    liquidationPrice,
    liquidationBuffer,
    maintenanceMargin,
  };
}

/**
 * Liquidation sits where the remaining collateral equals the maintenance requirement:
 *
 *   collateral + pnl(P) = maintenance x size x P
 *
 * Solved for a short that gives P = (collateral + size x entry) / (size x (1 + m)), and for a long
 * P = (size x entry - collateral) / (size x (1 - m)). `maintenance_margin` is in ten-thousandths.
 */
function liquidation(
  side: "long" | "short" | null,
  size: number | null,
  entryPrice: number | null,
  collateralUsd: number | null,
  markPrice: number | null,
  maintenanceMarginRaw: number | null,
): Pick<PositionView, "liquidationPrice" | "liquidationBuffer" | "maintenanceMargin"> {
  const none = { liquidationPrice: null, liquidationBuffer: null, maintenanceMargin: null };
  if (side === null || size === null || entryPrice === null || collateralUsd === null) return none;
  if (maintenanceMarginRaw === null || size <= 0) return none;

  const m = maintenanceMarginRaw / 10_000;
  const entryNotional = size * entryPrice;
  const price =
    side === "short"
      ? (collateralUsd + entryNotional) / (size * (1 + m))
      : (entryNotional - collateralUsd) / (size * (1 - m));

  if (!Number.isFinite(price) || price <= 0) {
    // A long collateralised past its own notional cannot be liquidated by price alone.
    return { ...none, maintenanceMargin: m };
  }
  const buffer =
    markPrice !== null && markPrice > 0 ? Math.abs(price - markPrice) / markPrice : null;
  return { liquidationPrice: price, liquidationBuffer: buffer, maintenanceMargin: m };
}
