import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from "viem";
import { deltaMonVaultAbi } from "@deltamon/shared";
import { redemptionPayout } from "./positionFeedback";

const vault = "0x1111111111111111111111111111111111111111" as Address;
const receiver = "0x2222222222222222222222222222222222222222" as Address;

function withdrawLog(address = vault, recipient = receiver): Log {
  return {
    address,
    topics: encodeEventTopics({
      abi: deltaMonVaultAbi,
      eventName: "Withdraw",
      args: { sender: receiver, receiver: recipient, owner: receiver },
    }),
    data: encodeAbiParameters(
      [
        { name: "assets", type: "uint256" },
        { name: "shares", type: "uint256" },
      ],
      [53_000_000n, 50n * 10n ** 18n],
    ),
  } as Log;
}

describe("redemption success feedback", () => {
  it("shows the actual USDC payout from this vault and receiver", () => {
    expect(redemptionPayout([withdrawLog()], vault, receiver)).toBe(53_000_000n);
    expect(
      redemptionPayout(
        [withdrawLog("0x3333333333333333333333333333333333333333")],
        vault,
        receiver,
      ),
    ).toBeUndefined();
    expect(
      redemptionPayout(
        [withdrawLog(vault, "0x4444444444444444444444444444444444444444")],
        vault,
        receiver,
      ),
    ).toBeUndefined();
  });
});
