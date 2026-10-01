import { describe, expect, it } from "vitest";
import { livePerpBook } from "../src/services/perpExposure.js";
import type { PerplAccount, PerplPosition } from "../src/services/perplSession.js";
import type { MarketConfig } from "../src/services/perplOrders.js";

/**
 * The keeper marks the vault with `pnl = equity - deployed`, so an equity that is short by the
 * collateral sitting inside a position records a loss that never happened. These fixtures are the
 * real shapes Perpl sent.
 */

const NOW = 1_790_600_000;

const MON: MarketConfig = {
  id: 10,
  name: "MON",
  priceDecimals: 6,
  sizeDecimals: 0,
  orderTtlBlocks: 20,
  isOpen: true,
  markPrice: 27_583,
  fundingRate: 0,
  fundingIntervalSec: 2_580,
  fundingSum: 82_750,
  fundingSumScalingExp: 2,
  maintenanceMargin: 2_000,
  initialMargin: 1_000,
  fundingLastAtMs: NOW * 1000,
};

/** A short as the socket reports it: collateral lives on the position, not in the balance. */
const shortPosition = (over: Record<string, unknown> = {}): PerplPosition => ({
  market: 10,
  size: "983",
  side: "short",
  entryPrice: "27583",
  collateral: "21705047",
  unrealisedPnl: null,
  raw: { mkt: 10, sd: 2, s: 983, ep: 27_583, c: "21705047", efs: 82_750, lv: 150, ...over },
});

const account = (p: Partial<PerplAccount> = {}): PerplAccount => ({
  connected: true,
  forwarding: true,
  availableBalance: "5119",
  lockedBalance: "0",
  marginUtilizationPct: 0,
  positions: [shortPosition()],
  openOrders: 0,
  updatedAt: new Date(NOW * 1000).toISOString(),
  lastError: null,
  accountId: 5329,
  accountAddress: "0x3efd48853f4b8c3f49b7601bd3419f54e8fd6dfc",
  blockHeight: 108_758_760,
  ...p,
});

describe("equity", () => {
  it("counts the collateral held inside a position, not just the free balance", () => {
    const { book } = livePerpBook(account(), 0.027583, MON, NOW);
    // 0.005119 free plus 21.705047 of collateral, flat at the mark.
    expect(Number(book!.equity) / 1e6).toBeCloseTo(21.710166, 5);
  });

  it("would otherwise report the whole book as lost", () => {
    const { book } = livePerpBook(account(), 0.027583, MON, NOW);
    const deployed = 21_000_000n; // what the vault sent the manager
    const pnl = book!.equity - deployed;
    // Free balance alone is 5119 units, which against 21 USDC deployed is a 21 dollar fake loss.
    expect(pnl).toBeGreaterThan(-1_000_000n);
  });

  it("moves with the position's unrealised result", () => {
    // Mark below entry: a short is in profit, and equity rises by size times the difference.
    const cheaper = { ...MON, markPrice: 26_583 };
    const { book } = livePerpBook(account(), 0.026583, cheaper, NOW);
    const flat = livePerpBook(account(), 0.027583, MON, NOW).book!;
    expect(book!.equity).toBeGreaterThan(flat.equity);
    expect(Number(book!.equity - flat.equity) / 1e6).toBeCloseTo(983 * 0.001, 4);
  });

  it("is just the free balance when nothing is open", () => {
    const { book } = livePerpBook(account({ positions: [] }), 0.027583, MON, NOW);
    expect(book!.equity).toBe(5_119n);
    expect(book!.shortNotional).toBe(0n);
  });
});

describe("short notional", () => {
  it("prices the short with the vault's own MON price", () => {
    const { book } = livePerpBook(account(), 0.03, MON, NOW);
    expect(book!.shortNotional).toBe(BigInt(Math.round(983 * 0.03 * 1e6)));
  });

  it("ignores a long and another market", () => {
    const longOnly = account({ positions: [shortPosition({ sd: 1 })] });
    expect(livePerpBook(longOnly, 0.03, MON, NOW).book!.shortNotional).toBe(0n);
    const elsewhere = account({ positions: [shortPosition({ mkt: 1 })] });
    expect(livePerpBook(elsewhere, 0.03, MON, NOW).book!.shortNotional).toBe(0n);
  });
});

describe("withholding the book", () => {
  it("says nothing rather than guess when the socket is down or unpriced", () => {
    expect(livePerpBook(account({ connected: false }), 0.03, MON, NOW).book).toBeNull();
    expect(livePerpBook(account({ availableBalance: null }), 0.03, MON, NOW).book).toBeNull();
    expect(livePerpBook(account(), 0, MON, NOW).book).toBeNull();
  });

  it("refuses to value an open position without market data", () => {
    const result = livePerpBook(account(), 0.03, null, NOW);
    expect(result.book).toBeNull();
    expect(result.reason).toMatch(/market data/);
  });

  it("withholds rather than skip a position it cannot read", () => {
    const broken = account({ positions: [shortPosition({ c: "not a number" })] });
    expect(livePerpBook(broken, 0.03, MON, NOW).book).toBeNull();
  });
});
