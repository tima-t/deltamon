import { describe, expect, it } from "vitest";
import { interpolatePaper, paperLength, PRESS_FEED_DURATION } from "./pressProgress";

describe("confirmed-milestone paper feed", () => {
  it("adds a distinct, bounded strip for each of four confirmations", () => {
    [0.65, 1.25, 1.85, 2.45, 3.05].forEach((length, step) =>
      expect(paperLength(step)).toBeCloseTo(length),
    );
    expect(paperLength(-1)).toBe(paperLength(0));
    expect(paperLength(99)).toBe(paperLength(4));
  });
  it("never advances beyond the latest confirmation, even after a long wait", () => {
    const target = paperLength(2);
    expect(interpolatePaper(paperLength(1), target, 100)).toBe(target);
    expect(interpolatePaper(target, target, 100)).toBe(target);
  });
  it("retargets from the current paper position without retracting or jumping", () => {
    const midway = interpolatePaper(paperLength(0), paperLength(1), PRESS_FEED_DURATION / 2);
    expect(interpolatePaper(midway, paperLength(2), 0)).toBe(midway);
    expect(interpolatePaper(midway, paperLength(2), 0.1)).toBeGreaterThan(midway);
    expect(interpolatePaper(midway, paperLength(2), PRESS_FEED_DURATION)).toBe(paperLength(2));
  });
});
