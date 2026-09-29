import { describe, expect, it } from "vitest";
import { describePosition, type RawPosition } from "../src/services/perpPositionView.js";
import type { MarketConfig } from "../src/services/perplOrders.js";

/**
 * The fixtures are a real position and a real market read off Perpl mainnet, so the arithmetic is
 * checked against numbers the exchange actually produced rather than invented ones.
 */
const MON: MarketConfig = {
  id: 10,
  name: "MON",
  priceDecimals: 6,
  sizeDecimals: 0,
  orderTtlBlocks: 20,
  isOpen: true,
  markPrice: 28_056,
  fundingRate: 0,
  fundingIntervalSec: 2_580,
  fundingSum: 82_750,
  fundingSumScalingExp: 2,
  maintenanceMargin: 2_000,
  initialMargin: 1_000,
  fundingLastAtMs: 1_790_605_567_000,
};

const SHORT: RawPosition = {
  mkt: 10,
  pid: 7_128_985_829_379,
  sd: 2,
  c: "10281336",
  ep: 27_634,
  s: 372,
  efs: 82_750,
  lv: 100,
  fnd: "0",
  dpnl: "0",
  fee: "3547",
};

describe("a real MON short", () => {
  const view = describePosition(SHORT, MON);

  it("unscales what the exchange reported", () => {
    expect(view.side).toBe("short");
    expect(view.size).toBe(372);
    expect(view.entryPrice).toBeCloseTo(0.027634, 9);
    expect(view.markPrice).toBeCloseTo(0.028056, 9);
    expect(view.collateralUsd).toBeCloseTo(10.281336, 9);
    expect(view.leverage).toBe(1);
    expect(view.positionId).toBe("7128985829379");
    expect(view.marketName).toBe("MON");
  });

  it("values the position at the mark, not at entry", () => {
    expect(view.notionalUsd).toBeCloseTo(372 * 0.028056, 9);
  });

  it("loses on a short when the mark rises above entry", () => {
    // 372 x (0.027634 - 0.028056)
    expect(view.unrealisedPnlUsd).toBeCloseTo(-0.156984, 9);
  });

  it("reports no funding while the market sum still matches the entry sum", () => {
    expect(view.unrealisedFundingUsd).toBe(0);
    expect(view.realisedFundingUsd).toBe(0);
    expect(view.fundingAccruedUsd).toBe(0);
    expect(view.fundingRate).toBe(0);
  });

  it("says when the next funding settles, one interval after the last", () => {
    expect(view.nextFundingAtMs).toBe(1_790_605_567_000 + 2_580_000);
  });

  it("unscales the funding rate by the market's price decimals", () => {
    // The wire value 10 is 1.0e-5 of notional per interval, not 10x. Reading it literally
    // published a 12,000,000% annual rate.
    const paying = describePosition(SHORT, { ...MON, fundingRate: 10 });
    expect(paying.fundingRate).toBeCloseTo(1e-5, 12);
    expect(paying.fundingRateAnnualised).toBeCloseTo(1e-5 * ((365 * 24 * 3600) / 2580), 6);
    // Sanity: a plausible double-digit annual percentage, not millions.
    expect(paying.fundingRateAnnualised!).toBeLessThan(1);
  });

  it("adds realised and unrealised funding into one accrued figure", () => {
    const both = describePosition(
      { ...SHORT, fnd: "1500" },
      { ...MON, fundingSum: 82_750 + 100_000 },
    );
    // 0.0015 realised plus (100000 x 372) / 1e8 accrued since entry.
    expect(both.fundingAccruedUsd).toBeCloseTo(0.0015 + (100_000 * 372) / 1e8, 9);
  });

  it("derives a liquidation price above the entry, since a short loses as price climbs", () => {
    // 0.027634 + (10.281336 - 0.05 x 372 x 0.027634) / 372. app.perpl.xyz showed 0.0539.
    expect(view.liquidationPrice).toBeCloseTo(0.0538903, 7);
    expect(view.liquidationPrice!).toBeGreaterThan(view.entryPrice!);
    // maintenance_margin 2000 is 20x in hundredths, so 5%.
    expect(view.maintenanceMargin).toBeCloseTo(0.05, 9);
  });

  it("measures the buffer from the mark, not from entry", () => {
    // (0.0538903 - 0.028056) / 0.028056
    expect(view.liquidationBuffer).toBeCloseTo(0.9208, 3);
    // Perpl showed 86.6% with the mark at 0.02888.
    const later = describePosition(SHORT, { ...MON, markPrice: 28_880 });
    expect(later.liquidationBuffer).toBeCloseTo(0.866, 3);
  });
});

describe("the other direction and the missing pieces", () => {
  it("puts a long's liquidation below its entry", () => {
    // 6 USDC against a 10.28 notional, comfortably above the maintenance requirement.
    const long = describePosition({ ...SHORT, sd: 1, c: "6000000" }, MON);
    expect(long.side).toBe("long");
    expect(long.liquidationPrice!).toBeLessThan(long.entryPrice!);
    // A long gains as the mark rises above entry.
    expect(long.unrealisedPnlUsd).toBeCloseTo(372 * (0.028056 - 0.027634), 9);
  });

  it("will not liquidate a long collateralised beyond its own notional", () => {
    const overfunded = describePosition({ ...SHORT, sd: 1, c: "999000000" }, MON);
    expect(overfunded.liquidationPrice).toBeNull();
  });

  it("accrues funding once the market sum moves past the entry sum", () => {
    // funding sum is scaled by priceDecimals plus the market's extra exponent, so 10^8 here.
    const moved = describePosition(SHORT, { ...MON, fundingSum: 82_750 + 100_000 });
    expect(moved.unrealisedFundingUsd).toBeCloseTo((100_000 * 372) / 1e8, 9);
  });

  it("leaves a barely solvent position almost no buffer", () => {
    // 0.515 USDC against a 0.514 maintenance requirement (5% of the 10.28 entry notional).
    // Still solvent, so liquidation sits just under the mark rather than above it.
    const thin = describePosition({ ...SHORT, sd: 1, c: "515000" }, MON);
    expect(thin.liquidationPrice!).toBeLessThan(thin.markPrice!);
    expect(thin.liquidationBuffer!).toBeLessThan(0.02);
  });

  it("returns nulls rather than plausible zeros when the venue is quiet", () => {
    const blind = describePosition(SHORT, {
      ...MON,
      markPrice: null,
      maintenanceMargin: null,
      fundingSum: null,
    });
    expect(blind.markPrice).toBeNull();
    expect(blind.notionalUsd).toBeNull();
    expect(blind.unrealisedPnlUsd).toBeNull();
    expect(blind.liquidationPrice).toBeNull();
    expect(blind.liquidationBuffer).toBeNull();
    expect(blind.unrealisedFundingUsd).toBeNull();
    // What the position itself carries is still readable.
    expect(blind.size).toBe(372);
    expect(blind.entryPrice).toBeCloseTo(0.027634, 9);
  });
});
