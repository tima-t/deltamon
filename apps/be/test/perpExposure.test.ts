import { describe, expect, it } from "vitest";
import { livePerpBook, shortSizeOf } from "../src/services/perpExposure.js";
import { toPosition, type PerplAccount, type PerplPosition } from "../src/services/perplSession.js";

const MON_MARKET = 10;
const NOW = 1_790_600_000;

const position = (p: Partial<PerplPosition>): PerplPosition => ({
  market: MON_MARKET,
  size: null,
  side: null,
  entryPrice: null,
  collateral: null,
  unrealisedPnl: null,
  raw: {},
  ...p,
});

const account = (p: Partial<PerplAccount> = {}): PerplAccount => ({
  connected: true,
  forwarding: true,
  availableBalance: "10500000",
  lockedBalance: "0",
  marginUtilizationPct: 0,
  positions: [],
  openOrders: 0,
  updatedAt: new Date(NOW * 1000).toISOString(),
  lastError: null,
  accountId: 5329,
  accountAddress: "0x3efd48853f4b8c3f49b7601bd3419f54e8fd6dfc",
  blockHeight: 108_758_760,
  ...p,
});

describe("reading a short out of a position", () => {
  it("counts a declared short and ignores a long", () => {
    expect(shortSizeOf(position({ size: "500", side: "short" }), MON_MARKET)).toBe(500);
    expect(shortSizeOf(position({ size: "500", side: "long" }), MON_MARKET)).toBe(0);
  });

  it("reads a negative size as a short when no side is given", () => {
    expect(shortSizeOf(position({ size: "-500" }), MON_MARKET)).toBe(500);
    expect(shortSizeOf(position({ size: "500" }), MON_MARKET)).toBe(0);
  });

  it("ignores another market entirely", () => {
    expect(shortSizeOf(position({ market: 1, size: "-2", side: "short" }), MON_MARKET)).toBe(0);
  });

  it("says so when the row cannot be read", () => {
    expect(shortSizeOf(position({ size: null }), MON_MARKET)).toBeNull();
    expect(shortSizeOf(position({ size: "not a number" }), MON_MARKET)).toBeNull();
  });
});

describe("the live perp book", () => {
  it("reports a flat account as a real zero short", () => {
    const { book } = livePerpBook(account(), 0.029, MON_MARKET, NOW);
    expect(book).toMatchObject({ equity: 10_500_000n, shortNotional: 0n, asOfSec: BigInt(NOW) });
  });

  it("prices the short with the vault's own MON price", () => {
    const { book } = livePerpBook(
      account({ positions: [position({ size: "500", side: "short" })] }),
      0.03,
      MON_MARKET,
      NOW,
    );
    // 500 MON at $0.03 is $15.00, in six decimal USDC units.
    expect(book?.shortNotional).toBe(15_000_000n);
  });

  it("adds up several shorts and nets nothing from the longs", () => {
    const { book } = livePerpBook(
      account({
        positions: [
          position({ size: "300", side: "short" }),
          position({ size: "-200" }),
          position({ size: "1000", side: "long" }),
        ],
      }),
      0.02,
      MON_MARKET,
      NOW,
    );
    expect(book?.shortNotional).toBe(10_000_000n); // 500 MON at $0.02
  });

  it("counts locked collateral into equity", () => {
    const { book } = livePerpBook(
      account({ availableBalance: "4000000", lockedBalance: "6500000" }),
      0.029,
      MON_MARKET,
      NOW,
    );
    expect(book?.equity).toBe(10_500_000n);
  });

  it("withholds the book rather than claim a zero short it cannot verify", () => {
    const result = livePerpBook(
      account({ positions: [position({ size: "garbage" })] }),
      0.029,
      MON_MARKET,
      NOW,
    );
    expect(result.book).toBeNull();
    expect(result.reason).toMatch(/could not be read/);
  });

  it("has nothing to say while the socket is down or unpriced", () => {
    expect(livePerpBook(account({ connected: false }), 0.029, MON_MARKET, NOW).book).toBeNull();
    expect(livePerpBook(account({ availableBalance: null }), 0.029, MON_MARKET, NOW).book).toBeNull();
    expect(livePerpBook(account(), 0, MON_MARKET, NOW).book).toBeNull();
  });
});

describe("toPosition", () => {
  // A snapshot row as Perpl sent it: `sd` is a PositionType number and the size is unsigned.
  const frame = { mkt: 10, sd: 2, s: 372, ep: 27634, c: "10281336" };

  it("reads sd 2 as a short, which the book then counts", () => {
    const parsed = toPosition(frame);
    expect(parsed.side).toBe("short");
    expect(shortSizeOf(parsed, MON_MARKET)).toBe(372);
  });

  it("reads sd 1 as a long", () => {
    expect(toPosition({ ...frame, sd: 1 }).side).toBe("long");
  });
});
