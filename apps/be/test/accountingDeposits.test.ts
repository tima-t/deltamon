import { describe, expect, it } from "vitest";
import { depositTotal } from "../src/services/accountingDeposits.js";
import type { DepositScan } from "../src/services/accountingStore.js";

const scan = (overrides: Partial<DepositScan> = {}): DepositScan => ({
  _id: "deposits:143:0xabc",
  scope: "143:0xabc",
  fromBlock: "107645440",
  syncedTo: "113000000",
  depositedRaw: "50000000",
  depositCount: 2,
  complete: true,
  ...overrides,
});

describe("total deposited capital", () => {
  it("converts the running raw sum with the vault's asset decimals", () => {
    expect(depositTotal(scan(), 6).totalDepositedUsd).toBe(50);
  });

  it("withholds a partial sum, because a half-scanned total is not a total", () => {
    const partial = depositTotal(scan({ complete: false }), 6);
    expect(partial.totalDepositedUsd).toBeNull();
    expect(partial.depositCount).toBeNull();
    // The cursor still travels, so a reader can see the scan progressing.
    expect(partial.syncedToBlock).toBe("113000000");
  });

  it("reads as unavailable before any scan has been stored", () => {
    expect(depositTotal(null, 6)).toEqual({
      totalDepositedUsd: null,
      complete: false,
      syncedToBlock: null,
      depositCount: null,
      fromBlock: null,
    });
  });

  it("reports the block the sum started from, so a stale deployment record is visible", () => {
    expect(depositTotal(scan(), 6).fromBlock).toBe("107645440");
  });
});
