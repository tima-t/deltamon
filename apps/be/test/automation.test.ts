import { describe, expect, it } from "vitest";
import { AutomationConfigSchema, DEFAULT_AUTOMATION_CONFIG } from "@deltamon/shared";

import { windowKey } from "../src/services/automationSchedule.js";

describe("the automation config", () => {
  it("starts switched off, at a 60/40 split, on every deposit", () => {
    expect(DEFAULT_AUTOMATION_CONFIG).toMatchObject({
      enabled: false,
      monAusdSplitRatio: 0.6,
      flowPipelinePeriod: "deposit",
    });
  });

  it("holds the ratio inside zero to one and the buffer inside zero to fifty", () => {
    const base = { ...DEFAULT_AUTOMATION_CONFIG };
    expect(AutomationConfigSchema.safeParse({ ...base, monAusdSplitRatio: 1.2 }).success).toBe(
      false,
    );
    expect(AutomationConfigSchema.safeParse({ ...base, monAusdSplitRatio: -0.1 }).success).toBe(
      false,
    );
    expect(AutomationConfigSchema.safeParse({ ...base, unbondBufferLevel: 51 }).success).toBe(false);
    expect(AutomationConfigSchema.safeParse({ ...base, unbondBufferLevel: 0 }).success).toBe(true);
    expect(AutomationConfigSchema.safeParse({ ...base, flowPipelinePeriod: "weekly" }).success).toBe(
      false,
    );
  });

  it("refuses leverage below 1x, which Perpl rejects anyway", () => {
    const base = { ...DEFAULT_AUTOMATION_CONFIG };
    expect(AutomationConfigSchema.safeParse({ ...base, shortLeverage: 0 }).success).toBe(false);
    expect(AutomationConfigSchema.safeParse({ ...base, shortLeverage: 150 }).success).toBe(true);
  });
});

describe("the periodic trigger key", () => {
  // The key is what stops a restart inside the same window from running the pipeline twice.
  const noon = Date.parse("2026-09-29T12:00:00Z");

  it("is stable across a restart inside the same window", () => {
    expect(windowKey("12h", noon)).toBe(windowKey("12h", noon + 3_600_000));
    expect(windowKey("24h", noon)).toBe(windowKey("24h", noon + 11 * 3_600_000));
  });

  it("moves on once the window does", () => {
    expect(windowKey("12h", noon)).not.toBe(windowKey("12h", noon + 13 * 3_600_000));
    expect(windowKey("24h", noon)).not.toBe(windowKey("24h", noon + 25 * 3_600_000));
  });

  it("keeps the two periods apart", () => {
    expect(windowKey("12h", noon)).not.toBe(windowKey("24h", noon));
  });
});

describe("the pipeline's shape", () => {
  it("deposits collateral before it tries to short", async () => {
    const { STEP_NAMES } = await import("../src/services/flowEngine.js");
    const order = [...STEP_NAMES];
    // Perpl can only be margined by an on-chain deposit, so a short posted before it lands is
    // refused for want of collateral.
    expect(order.indexOf("depositToPerpl")).toBeLessThan(order.indexOf("openShort"));
    expect(order.indexOf("approvePerplCollateral")).toBeLessThan(order.indexOf("depositToPerpl"));
    // And the AUSD has to reach the manager before the manager can deposit it.
    expect(order.indexOf("fundPerpManager")).toBeLessThan(order.indexOf("approvePerplCollateral"));
    expect(order.indexOf("swapUsdcForMon")).toBe(0);
  });
});
