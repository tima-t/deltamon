import { describe, expect, it } from "vitest";
import { fetchPerpBook } from "../src/services/perpBook.js";

const feed = (body: unknown) => `data:application/json,${encodeURIComponent(JSON.stringify(body))}`;

describe("external manager feed migration", () => {
  it("accepts both the existing fields and optional six-decimal short notional", async () => {
    expect(await fetchPerpBook(feed({ equity: "40000000", asOf: 1_800_000_000 }))).toEqual({
      equity: 40_000_000n,
      asOfSec: 1_800_000_000n,
      shortNotional: undefined,
    });
    expect(
      (
        await fetchPerpBook(
          feed({ equity: "40000000", asOf: 1_800_000_000, shortNotional: "60000000" }),
        )
      ).shortNotional,
    ).toBe(60_000_000n);
  });

  it("rejects negative and non-integer notional values", async () => {
    await expect(
      fetchPerpBook(feed({ equity: "40000000", asOf: 1_800_000_000, shortNotional: "-1" })),
    ).rejects.toThrow();
    await expect(
      fetchPerpBook(feed({ equity: "40000000", asOf: 1_800_000_000, shortNotional: "60.1" })),
    ).rejects.toThrow();
  });
});
