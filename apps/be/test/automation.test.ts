import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
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

describe("the enabled switch", () => {
  it("is checked before a deposit can start a run", async () => {
    const src = await readFile(
      new URL("../src/services/automationRunner.ts", import.meta.url),
      "utf8",
    );
    const scanner = src.slice(src.indexOf("async function scanVaultEvents"), src.indexOf("async function blockTimes"));
    const guard = scanner.indexOf("if (!config.enabled) continue;");
    const start = scanner.indexOf("await startFlow(");
    // The feed still records deposits while the automation is off; only the run must not begin.
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(start);
    expect(scanner).toContain("recordActivity(");
  });
});

describe("the minimum idle threshold", () => {
  it("converts whole USDC to the asset's six decimals", async () => {
    const { thresholdUnits } = await import("../src/services/automationSchedule.js");
    expect(thresholdUnits(30)).toBe(30_000_000n);
    expect(thresholdUnits(2.5)).toBe(2_500_000n);
  });

  it("keeps a floor of one dollar even when the threshold is zero", async () => {
    const { thresholdUnits, MIN_DEPLOY_USDC } = await import(
      "../src/services/automationSchedule.js"
    );
    // A run costs seven transactions; allocating dust loses money on gas alone.
    expect(thresholdUnits(0)).toBe(MIN_DEPLOY_USDC);
    expect(thresholdUnits(0.25)).toBe(MIN_DEPLOY_USDC);
  });

  it("accumulates: two small deposits wait, the third crosses", async () => {
    const { thresholdUnits } = await import("../src/services/automationSchedule.js");
    const limit = thresholdUnits(30);
    const idleAfter = (...deposits: number[]) =>
      deposits.reduce((sum, d) => sum + BigInt(Math.round(d * 1e6)), 0n);
    expect(idleAfter(5) >= limit).toBe(false);
    expect(idleAfter(5, 5) >= limit).toBe(false);
    expect(idleAfter(5, 5, 30) >= limit).toBe(true);
    // And the run allocates the whole 40, not just the deposit that tripped it.
    expect(idleAfter(5, 5, 30)).toBe(40_000_000n);
  });
});

describe("reading a config written before a setting existed", () => {
  it("keeps what the document carries and defaults only what it lacks", async () => {
    const { AutomationConfigSchema } = await import("@deltamon/shared");
    const stored = {
      enabled: true,
      monAusdSplitRatio: 0.7,
      flowPipelinePeriod: "12h" as const,
      unbondBufferLevel: 25,
      shortLeverage: 200,
      updatedAt: "2026-09-30T00:00:00Z",
      updatedBy: "0xabc",
    };
    // Whole-document validation fails on the field that did not exist yet.
    expect(AutomationConfigSchema.safeParse(stored).success).toBe(false);

    // Field by field over the defaults, nothing the operator set is lost.
    const merged = { ...DEFAULT_AUTOMATION_CONFIG, ...AutomationConfigSchema.partial().parse(stored) };
    const whole = AutomationConfigSchema.parse(merged);
    expect(whole.enabled).toBe(true);
    expect(whole.shortLeverage).toBe(200);
    expect(whole.monAusdSplitRatio).toBe(0.7);
    expect(whole.minIdleUsdcStart).toBe(DEFAULT_AUTOMATION_CONFIG.minIdleUsdcStart);
  });
});
