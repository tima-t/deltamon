import { describe, expect, it } from "vitest";
import { planPerpMark, type PerpMarkInput } from "../src/services/keeperPlan.js";

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

describe("keeping the mark fresh", () => {
  // Deposits are blocked while the mark is stale, so the keeper refreshes at half the vault's
  // limit rather than waiting for it to lapse.
  // The book has to keep pace with the clock: a feed older than maxBookAgeSec is refused, which
  // is correct and is not what these cases are about.
  const at = (seconds: bigint) => ({
    ...base,
    nowSec: T0 + seconds,
    book: { equity: 1_000n * USDC, asOfSec: T0 + seconds - 10n },
  });

  it("re-marks at half the max age, before anything is blocked", () => {
    expect(planPerpMark(at(10_800n))).toMatchObject({ kind: "report", reason: "mark is due" });
  });

  it("still re-marks once it has actually lapsed", () => {
    expect(planPerpMark(at(21_601n))).toMatchObject({ kind: "report", reason: "mark is stale" });
  });

  it("cannot mark at all without a book, and says deposits stay paused", () => {
    const blind = planPerpMark({ ...at(21_601n), book: null });
    expect(blind.kind).toBe("skip");
    expect(blind.kind === "skip" && blind.alerts.join(" ")).toContain("deposits stay paused");
  });

  it("leaves a fresh, unmoved mark alone", () => {
    expect(planPerpMark(base)).toMatchObject({ kind: "skip" });
  });
});
