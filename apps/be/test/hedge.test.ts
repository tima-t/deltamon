import { describe, expect, it } from "vitest";
import { assessHedge } from "../src/services/hedge.js";

const now = 1_800_000_000;
const report = (shortNotional?: bigint, asOfSec = BigInt(now)) => ({
  equity: 40_000_000n,
  asOfSec,
  shortNotional,
});

describe("manager-reported net exposure", () => {
  it("measures a leveraged short against MON value, not collateral", () => {
    expect(assessHedge(60, 100, report(60_000_000n), 40, 40, now)).toMatchObject({
      shortExposureUsd: 60,
      netDeltaBps: 0,
      dataStatus: "fresh",
    });
    expect(assessHedge(63, 100, report(60_000_000n), 40, 40, now).netDeltaBps).toBe(300);
    expect(assessHedge(62, 100, report(60_000_000n), 40, 40, now).netDeltaBps).toBe(200);
    expect(assessHedge(62.01, 100, report(60_000_000n), 40, 40, now).netDeltaBps).toBe(201);
  });

  it("never asserts neutrality from a missing, stale or future report", () => {
    expect(assessHedge(60, 100, null, 40, 40, now).netDeltaBps).toBeNull();
    expect(assessHedge(60, 100, report(undefined), 40, 40, now).dataStatus).toBe("unavailable");
    expect(
      assessHedge(60, 100, report(60_000_000n, BigInt(now - 300)), 40, 40, now).dataStatus,
    ).toBe("fresh");
    expect(assessHedge(60, 100, report(60_000_000n, BigInt(now - 301)), 40, 40, now)).toMatchObject(
      { dataStatus: "stale", netDeltaBps: null },
    );
    expect(assessHedge(60, 100, report(60_000_000n, BigInt(now + 31)), 40, 40, now)).toMatchObject({
      dataStatus: "unavailable",
      netDeltaBps: null,
    });
    expect(assessHedge(60, 0, report(60_000_000n), 40, 40, now).netDeltaBps).toBeNull();
  });
});
