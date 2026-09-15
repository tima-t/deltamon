import { describe, expect, it } from "vitest";
import { planPerpMark, planQueue, type PerpMarkInput } from "../src/services/keeperPlan.js";

const USDC = 1_000_000n;
const T0 = 1_726_000_000n;

const base: PerpMarkInput = {
  deployed: 1_000n * USDC,
  reportedPnl: 0n,
  reportedAt: T0,
  maxAgeSec: 21_600n, // 6 h
  bandBps: 5_000n,
  nowSec: T0 + 60n,
  minChangeBps: 25n,
  maxBookAgeSec: 300n,
  book: { equity: 1_000n * USDC, asOfSec: T0 + 50n },
};

const bookAt = (equityUsdc: bigint, asOfSec = base.nowSec) => ({
  equity: equityUsdc * USDC,
  asOfSec,
});

describe("planPerpMark", () => {
  it("does nothing while no capital is out", () => {
    expect(planPerpMark({ ...base, deployed: 0n }).kind).toBe("idle");
  });

  it("never invents a mark without a feed, and warns once the mark is stale", () => {
    expect(planPerpMark({ ...base, book: null })).toMatchObject({ kind: "skip", alerts: [] });
    const stale = planPerpMark({ ...base, book: null, nowSec: T0 + base.maxAgeSec + 1n });
    expect(stale.kind).toBe("skip");
    expect(stale.kind === "skip" && stale.alerts.length).toBe(1);
  });

  it("refuses a feed that is itself stale", () => {
    const plan = planPerpMark({ ...base, book: bookAt(1_200n, base.nowSec - 301n) });
    expect(plan.kind).toBe("skip");
  });

  it("refuses a feed stamped ahead of the chain", () => {
    expect(planPerpMark({ ...base, book: bookAt(1_200n, base.nowSec + 61n) }).kind).toBe("skip");
    expect(planPerpMark({ ...base, book: bookAt(1_200n, base.nowSec + 30n) }).kind).toBe("report");
  });

  it("skips a fresh mark while the book stays inside the threshold", () => {
    // 2 USDC on 1,000 deployed is under the 25 bps threshold of 2.5 USDC.
    expect(planPerpMark({ ...base, book: bookAt(1_002n) }).kind).toBe("skip");
  });

  it("reports once the book moves past the threshold", () => {
    expect(planPerpMark({ ...base, book: bookAt(1_030n) })).toMatchObject({
      kind: "report",
      pnl: 30n * USDC,
    });
  });

  it("refreshes at half the vault's limit, before the mark can lapse", () => {
    const now = T0 + base.maxAgeSec / 2n;
    expect(planPerpMark({ ...base, nowSec: now, book: bookAt(1_000n, now) })).toMatchObject({
      kind: "report",
      pnl: 0n,
      reason: "mark is due",
    });
  });

  it("re-marks at once after the vault invalidated the mark", () => {
    expect(planPerpMark({ ...base, reportedAt: 0n, book: bookAt(1_000n) })).toMatchObject({
      kind: "report",
      reason: "mark is stale",
    });
  });

  it("keeps a gain inside the band and flags a loss past it for the admin", () => {
    expect(planPerpMark({ ...base, book: bookAt(1_800n) })).toMatchObject({
      kind: "report",
      pnl: 500n * USDC,
    });
    const loss = planPerpMark({ ...base, book: bookAt(300n) });
    expect(loss).toMatchObject({ kind: "report", pnl: -500n * USDC });
    expect(loss.kind === "report" && loss.alerts[0]).toContain("admin must mark it");
  });
});

describe("planQueue", () => {
  const DEADLINE = 129_600n;
  const entry = (id: bigint, gross: bigint | null, settled = false) => ({
    id,
    requestedAt: 1_000n,
    settled,
    gross,
  });

  it("pays oldest first as far as the idle USDC reaches, then reports the shortfall", () => {
    const plan = planQueue([entry(0n, 400n), entry(1n, 500n), entry(2n, 50n)], 600n, DEADLINE);
    expect(plan.claims).toEqual([0n]);
    expect(plan.shortfall).toEqual({ id: 1n, needed: 300n, dueAt: 130_600n });
  });

  it("never skips ahead to a smaller later request", () => {
    expect(planQueue([entry(0n, 900n), entry(1n, 10n)], 100n, DEADLINE).claims).toEqual([]);
  });

  it("asks to advance past a settled head and pays what follows", () => {
    expect(planQueue([entry(0n, null, true), entry(1n, 100n)], 100n, DEADLINE)).toMatchObject({
      advance: true,
      claims: [1n],
      shortfall: null,
    });
  });

  it("settles nothing while the oracle cannot price a request", () => {
    expect(planQueue([entry(0n, null)], 1_000n, DEADLINE)).toMatchObject({
      advance: false,
      claims: [],
      shortfall: null,
    });
  });
});
