import { describe, expect, it, vi } from "vitest";
import type { VaultAccountingSnapshot } from "@deltamon/shared";
import {
  accountingDaily,
  estimatedStakingMon,
  reconciledFunding,
  type DailyInputs,
} from "../src/services/accountingMath.js";
import {
  eventIdentity,
  normalizeHistoryEvents,
  positionFundingUsd,
  syncHistoryStream,
} from "../src/services/accountingPerpl.js";
import type {
  AccountingEvent,
  FundingObservation,
  HistoryCursor,
  PerplBinding,
} from "../src/services/accountingStore.js";

const binding: PerplBinding = {
  _id: "binding:vault",
  scope: "vault:perpl:5329",
  profile: "0xabc",
  accountId: 5329,
  instanceId: 1,
  marketId: 10,
  historyFrom: null,
};
const from = "2026-10-10T00:00:00.000Z",
  to = "2026-10-11T12:00:00.000Z";
function at(time: string, log = 1) {
  return { t: Date.parse(time), b: 100, tx: 1, txid: "abc", l: log };
}
function position(time = from, overrides: Record<string, unknown> = {}) {
  return {
    at: at(time),
    acc: 5329,
    mkt: 10,
    pid: 1,
    sr: 17,
    fnd: "2000000",
    dpnl: "0",
    ...overrides,
  };
}
function account(time = from, overrides: Record<string, unknown> = {}) {
  return {
    at: at(time),
    in: 1,
    id: 5329,
    m: 10,
    p: 1,
    et: 8,
    a: "1900000",
    f: "100000",
    ...overrides,
  };
}
function snapshot(
  time: string,
  overrides: Partial<VaultAccountingSnapshot> = {},
): VaultAccountingSnapshot {
  return {
    at: time,
    recordedAt: time,
    chainId: 143,
    vault: "0xabc",
    blockNumber: "100",
    totalAssetsRaw: "100000000",
    totalSupplyRaw: "100000000000000000000",
    assetDecimals: 6,
    shareDecimals: 18,
    pricePerShareUsd: 1,
    netAssetsUsd: 100,
    grossAssetsUsd: 101,
    accruedFeesUsd: 1,
    idleUsdcUsd: 10,
    idleAusdUsd: 1,
    monHeld: 2000,
    stakedMon: 1000,
    unstakingMon: 500,
    monPriceUsd: 0.03,
    shortBackingCapitalUsd: 30,
    shortEquityBookedUsd: 30,
    shortBookedAt: time,
    shortBookFresh: true,
    stakingApyBps: 1100,
    ...overrides,
  };
}
function observation(time: string, openFundingUsd: number | null): FundingObservation {
  return {
    _id: time,
    scope: binding.scope,
    at: time,
    openFundingUsd,
    shortNotionalUsd: 60,
    marketFundingSum: 100,
    marketFundingAt: time,
    priceDecimals: 6,
    sizeDecimals: 0,
    fundingSumScalingExp: 0,
    positions: [],
  };
}
function daily(overrides: Partial<DailyInputs> = {}) {
  return accountingDaily({
    from,
    to,
    snapshots: [],
    observations: [],
    events: [],
    marketId: 10,
    fundingThrough: to,
    fillsThrough: to,
    positionsThrough: to,
    historyFrom: null,
    maxGapMs: 900_000,
    ...overrides,
  });
}

describe("Perpl history normalization", () => {
  it("values unpaid funding with venue lot and price scales for both position sides", () => {
    const scales = { priceDecimals: 6, sizeDecimals: 2, fundingSumScalingExp: 2 };
    expect(positionFundingUsd(2, 98300, 87503, 76243, scales)).toBeCloseTo(-0.1106858, 10);
    expect(positionFundingUsd(1, 98300, 87503, 76243, scales)).toBeCloseTo(0.1106858, 10);
    expect(positionFundingUsd(2, 98300, 87503, 87503, scales)).toBe(0);
    expect(() => positionFundingUsd(0, 98300, 87503, 76243, scales)).toThrow("side");
  });
  it("records funding realised on position increases, and preserves exact raw amounts", () => {
    const rows = normalizeHistoryEvents("position-history", [position()], binding);
    expect(rows[0]?.fundingRaw).toBe("2000000");
    expect(rows[0]?.raw.sr).toBe(17);
  });
  it("restores account gross funding because the reported amount already includes its fee", () => {
    expect(normalizeHistoryEvents("account-history", [account()], binding)[0]?.fundingRaw).toBe(
      "2000000",
    );
    expect(
      normalizeHistoryEvents("account-history", [account(from, { a: "-2100000" })], binding)[0]
        ?.fundingRaw,
    ).toBe("-2000000");
  });
  it("does not sum mirrored account and position funding, but keeps independent payments", () => {
    const rows = [
      ...normalizeHistoryEvents(
        "account-history",
        [account(), account(from, { at: at(from, 2), a: "-500000", f: "0" })],
        binding,
      ),
      ...normalizeHistoryEvents("position-history", [position()], binding),
    ];
    const settled = reconciledFunding(rows, 10);
    expect(settled).toHaveLength(2);
    expect(settled.reduce((s, e) => s + BigInt(e.fundingRaw!), 0n)).toBe(1500000n);
  });
  it("takes trading fees only from fills, including negative rebates", () => {
    const row = normalizeHistoryEvents(
      "fills",
      [{ at: at(from), acc: 5329, mkt: 10, oid: 2, f: "-1234" }],
      binding,
    )[0]!;
    expect(row.tradingFeeRaw).toBe("-1234");
    expect(row.fundingRaw).toBeNull();
    expect(
      normalizeHistoryEvents("account-history", [account()], binding)[0]?.tradingFeeRaw,
    ).toBeNull();
  });
  it("filters other accounts, protocol instances and activity before the strategy start", () => {
    expect(
      normalizeHistoryEvents(
        "account-history",
        [account(from, { id: 999 }), account(from, { in: 2 })],
        binding,
      ),
    ).toEqual([]);
    expect(
      normalizeHistoryEvents("position-history", [position()], { ...binding, historyFrom: to }),
    ).toEqual([]);
  });
  it("expands nested settlement events without also counting the parent snapshot", () => {
    const parent = position(from, {
      fnd: "9999999",
      e: [position(from, { fnd: "1" }), position(from, { at: at(from, 2), fnd: "2" })],
    });
    expect(
      normalizeHistoryEvents("position-history", [parent], binding).map((e) => e.fundingRaw),
    ).toEqual(["1", "2"]);
  });
  it("deduplicates by immutable log identity, not amount, and keeps both inversion events", () => {
    expect(eventIdentity("position-history", position()).key).toBe(
      eventIdentity("position-history", position(from, { fnd: "3" })).key,
    );
    expect(eventIdentity("position-history", position(from, { sr: 13 })).key).not.toBe(
      eventIdentity("position-history", position(from, { sr: 18 })).key,
    );
    expect(() =>
      eventIdentity("position-history", position(from, { at: { t: Date.parse(from) } })),
    ).toThrow("stable");
  });
  it("rejects malformed money instead of advancing history around it", () => {
    expect(() =>
      normalizeHistoryEvents("position-history", [position(from, { fnd: "NaN" })], binding),
    ).toThrow();
  });
});

describe("bounded, durable history sync", () => {
  const initial = (): HistoryCursor => ({
    _id: "cursor",
    scope: binding.scope,
    stream: "position-history",
    page: null,
    anchor: null,
    pendingHead: null,
    backfillComplete: false,
    syncedThrough: null,
    sweepStartedAt: null,
  });
  it("resumes a backfill after restart, then catches new head activity once without replay", async () => {
    let state = initial();
    const stored = new Map<string, AccountingEvent>();
    const old = position(from, { at: at(from, 1) });
    const older = position(from, { at: at(from, 2) });
    const fresh = position(to, { at: at(to, 3), fnd: "-1000000" });
    const readPage = vi.fn(async (_stream: string, page: string | null) =>
      page ? { d: [older], np: "" } : { d: [old], np: "older" },
    );
    const deps = {
      readPage,
      loadCursor: async () => structuredClone(state),
      saveCursor: async (s: HistoryCursor) => {
        state = structuredClone(s);
      },
      save: async (rows: AccountingEvent[]) => {
        for (const row of rows) if (!stored.has(row._id)) stored.set(row._id, row);
      },
    };
    await syncHistoryStream(binding, "position-history", 1, deps, from);
    expect(state.page).toBe("older");
    expect(state.backfillComplete).toBe(false);
    await syncHistoryStream(binding, "position-history", 1, deps, to);
    expect(readPage.mock.calls[1]?.[1]).toBe("older");
    expect(state.backfillComplete).toBe(true);
    expect(state.syncedThrough).toBe(from);
    expect(stored.size).toBe(2);
    readPage.mockImplementation(async () => ({ d: [fresh, old, older], np: "" }));
    await syncHistoryStream(binding, "position-history", 1, deps, to);
    await syncHistoryStream(binding, "position-history", 1, deps, to);
    expect(stored.size).toBe(3);
    expect(state.syncedThrough).toBe(to);
  });
  it("does not advance the durable cursor if event persistence fails", async () => {
    const saveCursor = vi.fn();
    await expect(
      syncHistoryStream(
        binding,
        "position-history",
        1,
        {
          loadCursor: async () => initial(),
          readPage: async () => ({ d: [position()], np: "next" }),
          save: async () => {
            throw new Error("mongo down");
          },
          saveCursor,
        },
        from,
      ),
    ).rejects.toThrow("mongo down");
    expect(saveCursor).not.toHaveBeenCalled();
  });
  it("refuses repeated cursors and leaves incomplete scans incomplete", async () => {
    const state = { ...initial(), page: "same", sweepStartedAt: from };
    const saveCursor = vi.fn();
    await expect(
      syncHistoryStream(
        binding,
        "position-history",
        2,
        {
          loadCursor: async () => state,
          readPage: async () => ({ d: [], np: "same" }),
          save: async () => {},
          saveCursor,
        },
        to,
      ),
    ).rejects.toThrow("non-advancing");
    expect(saveCursor).not.toHaveBeenCalled();
  });
});

describe("historical daily accounting", () => {
  it("uses effective APY rather than dividing APY by 365", () => {
    const expected = 1000 * (1.11 ** (1 / 365) - 1);
    expect(estimatedStakingMon(1000, 1100, 86400000)).toBeCloseTo(expected, 10);
    expect(estimatedStakingMon(1000, 0, 86400000)).toBe(0);
    expect(() => estimatedStakingMon(1000, -1, 1)).toThrow();
  });
  it("splits stake exposure at UTC midnight and keeps its historical rate and balance", () => {
    const a = snapshot("2026-10-10T23:55:00.000Z"),
      b = snapshot("2026-10-11T00:05:00.000Z", { stakingApyBps: 2000, stakedMon: 5000 });
    const rows = daily({ snapshots: [a, b] });
    const estimate = estimatedStakingMon(1000, 1100, 300000);
    expect(rows[0]?.stakingEstimatedMon).toBeCloseTo(estimate, 12);
    expect(rows[1]?.stakingEstimatedMon).toBeCloseTo(estimate, 12);
    expect(rows[0]?.stakingCoveredSeconds).toBe(300);
    expect(rows[1]?.stakingEstimatedUsd).toBeCloseTo(estimate * 0.03, 12);
    expect(rows[0]?.capitalInUseUsd).toBe(90); // MON held + book equity, never short notional.
  });
  it("keeps unknown rates and long observation outages unavailable", () => {
    expect(
      daily({
        snapshots: [snapshot(from, { stakingApyBps: null }), snapshot("2026-10-10T00:05:00.000Z")],
      })[0]?.stakingEstimatedMon,
    ).toBeNull();
    expect(daily({ snapshots: [snapshot(from), snapshot(to)] })[0]?.stakingEstimatedMon).toBeNull();
    expect(daily({ fundingThrough: null, fillsThrough: null })[0]?.fundingSettledUsd).toBeNull();
  });
  it("measures share return without treating deposits or virtual rewards as NAV earnings", () => {
    const rows = daily({
      snapshots: [
        snapshot(from),
        snapshot("2026-10-10T00:05:00.000Z", {
          netAssetsUsd: 200,
          totalSupplyRaw: "200000000000000000000",
        }),
        snapshot("2026-10-11T00:05:00.000Z", { pricePerShareUsd: 1.02 }),
      ],
    });
    expect(rows[0]?.vaultReturnPct).toBe(0);
    expect(rows[0]?.stakingEstimatedUsd).toBeGreaterThan(0);
    expect(rows[1]?.vaultReturnPct).toBeCloseTo(2);
  });
  it("withholds stale-book returns and resets the series after an empty vault", () => {
    const rows = daily({
      snapshots: [
        snapshot(from),
        snapshot("2026-10-10T23:55:00.000Z", { pricePerShareUsd: 1.5, shortBookFresh: false }),
        snapshot("2026-10-11T00:00:00.000Z", { totalSupplyRaw: "0", pricePerShareUsd: null }),
        snapshot("2026-10-11T00:05:00.000Z"),
      ],
    });
    expect(rows[0]?.vaultReturnPct).toBeNull();
    expect(rows[1]?.vaultReturnPct).toBe(0);
    expect(rows[1]?.returnSegment).toBe(1);
  });
  it("bridges funding settlement resets so opening, increasing or closing cannot erase earned income", () => {
    const a = "2026-10-10T00:05:00.000Z",
      b = "2026-10-10T00:10:00.000Z";
    const events = normalizeHistoryEvents(
      "position-history",
      [position(b, { fnd: "10000000" })],
      binding,
    );
    const result = daily({ events, observations: [observation(a, 10), observation(b, 1)] })[0]!;
    expect(result.fundingSettledUsd).toBe(10);
    expect(result.fundingObservedUsd).toBe(1); // 10 settled + 1 still open − 10 previously open.
    expect(result.fundingObservedSeconds).toBe(300);
    expect(result.partial).toBe(true);
  });
  it("preserves negative funding and rebates without double counting fees", () => {
    const events = [
      ...normalizeHistoryEvents(
        "position-history",
        [position(from, { fnd: "-5000000", dpnl: "3000000", fee: "1230000" })],
        binding,
      ),
      ...normalizeHistoryEvents(
        "fills",
        [{ at: at(from, 3), acc: 5329, mkt: 10, oid: 2, f: "-250000" }],
        binding,
      ),
    ];
    const result = daily({ events })[0]!;
    expect(result.fundingSettledUsd).toBe(-5);
    expect(result.realisedTradingPnlUsd).toBe(3);
    expect(result.tradingFeesUsd).toBe(-0.25);
  });
  it("does not manufacture observed funding across missing data, incomplete history or changed accounts", () => {
    const a = "2026-10-10T00:05:00.000Z",
      b = "2026-10-10T00:10:00.000Z";
    expect(
      daily({ observations: [observation(a, null), observation(b, 1)] })[0]?.fundingObservedUsd,
    ).toBeNull();
    expect(
      daily({ observations: [observation(a, 0), { ...observation(b, 1), scope: "another" }] })[0]
        ?.fundingObservedUsd,
    ).toBeNull();
    expect(
      daily({ fundingThrough: null, observations: [observation(a, 0), observation(b, 1)] })[0]
        ?.fundingObservedUsd,
    ).toBeNull();
  });
});
