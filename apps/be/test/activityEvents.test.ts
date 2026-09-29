import { describe, expect, it } from "vitest";
import { decodeEventLog, encodeEventTopics, type Hex } from "viem";
import { VAULT_EVENTS, toActivity } from "../src/services/activityEvents.js";
import { deltaMonVaultAbi } from "@deltamon/shared";

/**
 * Every signature here has to match the deployed ABI exactly: a mistyped parameter produces a
 * different topic0, the log is never matched, and the activity feed silently loses that event.
 * So each one is checked against the vault's own ABI rather than against itself.
 */

const abiTopic = (name: string, args: Record<string, unknown>): Hex =>
  encodeEventTopics({ abi: deltaMonVaultAbi, eventName: name as never, args: args as never })[0];

describe("the indexed vault events", () => {
  it("covers what a person can actually do to the vault", () => {
    const kinds = VAULT_EVENTS.map((e) => e.kind);
    for (const expected of [
      "vault.deposit",
      "vault.redeem",
      "vault.redeemInKind",
      "vault.swap",
      "vault.stake",
      "vault.unstake",
      "vault.fundManager",
      "vault.managerReturn",
    ]) {
      expect(kinds).toContain(expected);
    }
  });

  it("matches the deployed ABI signature for signature, not just by name", () => {
    for (const spec of VAULT_EVENTS) {
      const mine = encodeEventTopics({ abi: [spec.event], eventName: spec.event.name as never })[0];
      expect.soft(mine, `${spec.event.name} topic0 differs from the vault ABI`).toBe(
        abiTopic(spec.event.name, {}),
      );
    }
  });

  it("names no event the vault does not emit", () => {
    const known = new Set(
      deltaMonVaultAbi.filter((e) => e.type === "event").map((e) => (e as { name: string }).name),
    );
    for (const spec of VAULT_EVENTS) expect(known).toContain(spec.event.name);
  });
});

describe("reading a log into a line", () => {
  const log = (name: string, args: Record<string, unknown>) => {
    const topics = encodeEventTopics({
      abi: deltaMonVaultAbi,
      eventName: name as never,
      args: args as never,
    });
    return { name, topics, args };
  };

  it("describes a deposit in USDC and shares", () => {
    const spec = VAULT_EVENTS.find((e) => e.kind === "vault.deposit")!;
    const entry = toActivity(spec, {
      args: {
        sender: "0x1111111111111111111111111111111111111111",
        owner: "0x2222222222222222222222222222222222222222",
        assets: 2_000_000n,
        shares: 2_000_000_000_000_000_000n,
      },
      transactionHash: "0xabc",
      logIndex: 3,
      blockNumber: 42n,
    } as never);
    expect(entry.summary).toBe("2 USDC deposited for 2 sdMON");
    expect(entry.actor).toBe("0x2222222222222222222222222222222222222222");
    expect(entry.dedupeKey).toBe("0xabc:3");
    expect(entry.blockNumber).toBe(42);
  });

  it("describes unbonding as begun, not finished", () => {
    const spec = VAULT_EVENTS.find((e) => e.kind === "vault.unstake")!;
    const entry = toActivity(spec, {
      args: { validatorId: 5n, withdrawId: 0, monAmount: 372_000_000_000_000_000_000n },
      transactionHash: "0xdef",
      logIndex: 0,
      blockNumber: 1n,
    } as never);
    expect(entry.summary).toBe("Began unbonding 372 MON from validator 5");
  });

  it("signs a negative perp mark", () => {
    const spec = VAULT_EVENTS.find((e) => e.kind === "vault.perpMark")!;
    const loss = toActivity(spec, {
      args: { pnl: -1_500_000n, deployed: 10_000_000n },
      transactionHash: "0x1",
      logIndex: 0,
      blockNumber: 1n,
    } as never);
    expect(loss.summary).toContain("−1.5");
  });

  it("keys every row on the log, so a re-scan cannot duplicate it", () => {
    const spec = VAULT_EVENTS[0]!;
    const once = toActivity(spec, {
      args: { assets: 1n, shares: 1n },
      transactionHash: "0xsame",
      logIndex: 7,
      blockNumber: 9n,
    } as never);
    const twice = toActivity(spec, {
      args: { assets: 1n, shares: 1n },
      transactionHash: "0xsame",
      logIndex: 7,
      blockNumber: 9n,
    } as never);
    expect(once.dedupeKey).toBe(twice.dedupeKey);
  });

  it("decodes against the real ABI, proving the topics line up", () => {
    const { topics } = log("Staked", { validatorId: 5n });
    const decoded = decodeEventLog({
      abi: deltaMonVaultAbi,
      topics: topics as [Hex, ...Hex[]],
      // monAmount is the only unindexed parameter: 372e18.
      data: `0x${(372n * 10n ** 18n).toString(16).padStart(64, "0")}`,
    });
    expect(decoded.eventName).toBe("Staked");
  });
});
