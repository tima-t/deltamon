import { describe, expect, it } from "vitest";
import { getDepositStages } from "@/lib/crosschain/progress";
import { confirmedPressSteps, getMonadPressStages } from "./liveProgress";
const initial = {
  action: "deposit" as const,
  signed: false,
  allowanceSufficient: true,
  failed: false,
  submittedAmount: "125",
};

describe("live deposit press confirmations", () => {
  it("does not print a signed or deposited record merely because allowance exists", () => {
    expect(confirmedPressSteps(getMonadPressStages(initial))).toBe(0);
  });
  it("an approval receipt cannot finish a deposit receipt", () => {
    const stages = getMonadPressStages({
      ...initial,
      action: "approve",
      signed: true,
      receiptStatus: "success",
    });
    expect(confirmedPressSteps(stages)).toBe(2);
    expect(stages[3]?.state).toBe("waiting");
  });
  it("submitted and reverted deposits never print shares received", () => {
    for (const receiptStatus of [undefined, "reverted"] as const) {
      const stages = getMonadPressStages({
        ...initial,
        signed: true,
        receiptStatus,
        failed: receiptStatus === "reverted",
      });
      expect(confirmedPressSteps(stages)).toBe(2);
      expect(stages[3]?.state).toBe("waiting");
    }
  });
  it("a successful direct vault deposit finishes all four milestones", () => {
    expect(
      confirmedPressSteps(
        getMonadPressStages({ ...initial, signed: true, receiptStatus: "success" }),
      ),
    ).toBe(4);
  });
  it("Aurora success without verified shares cannot stamp a completed receipt", () => {
    expect(confirmedPressSteps(getDepositStages("SUCCESS", "Base", true, false))).toBe(3);
    expect(confirmedPressSteps(getDepositStages("SUCCESS", "Base", true, true))).toBe(4);
  });
  it("a failed vault call retains the two verified route milestones", () => {
    expect(confirmedPressSteps(getDepositStages("OPERATION_FAILED", "Base", true, false))).toBe(2);
  });
});
