import { describe, expect, it } from "vitest";
import type { VaultStats } from "@deltamon/shared";
import { exposureReading } from "./exposureReading";

const now = Date.parse("2026-09-30T10:00:00.000Z");
const hedge: VaultStats["hedge"] = {
  longExposureUsd: 80_000,
  shortExposureUsd: 79_500,
  managerCapitalUsd: 40_000,
  managerEquityUsd: 40_500,
  netDeltaBps: 50,
  reportAsOf: "2026-09-30T09:59:00.000Z",
  dataStatus: "fresh",
};

describe("exposureReading", () => {
  it("shows a current measured net value and target state", () => {
    const reading = exposureReading({ source: "onchain", hedge }, now);
    expect(reading.shownDelta).toBe(50);
    expect(reading.shortDrawable).toBe(true);
    expect(reading.status).toBe("Within ±2% target");
  });

  it("does not imply balance when short notional is missing", () => {
    const reading = exposureReading(
      { source: "onchain", hedge: { ...hedge, shortExposureUsd: null } },
      now,
    );
    expect(reading.shownDelta).toBeNull();
    expect(reading.shortDrawable).toBe(false);
    expect(reading.status).toBe("Short report unavailable");
  });

  it("withdraws the net reading when a report ages out", () => {
    const reading = exposureReading({ source: "onchain", hedge }, now + 5 * 60_000);
    expect(reading.shownDelta).toBeNull();
    expect(reading.shortDrawable).toBe(false);
    expect(reading.status).toBe("Manager report stale");
  });

  it("rejects a future-dated report outside clock tolerance", () => {
    const reading = exposureReading(
      { source: "onchain", hedge: { ...hedge, reportAsOf: "2026-09-30T10:01:00.000Z" } },
      now,
    );
    expect(reading.shownDelta).toBeNull();
    expect(reading.shortDrawable).toBe(false);
    expect(reading.status).toBe("Manager report time invalid");
  });

  it("keeps examples explicit and does not give them a live target status", () => {
    const reading = exposureReading({ source: "demo", hedge }, now);
    expect(reading.shownDelta).toBe(50);
    expect(reading.status).toBe("Illustrative example");
    expect(reading.tone).toBe("muted");
  });
});
