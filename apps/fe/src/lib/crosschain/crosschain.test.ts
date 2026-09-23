import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => ({
  code: undefined as string | undefined,
  balance: 0n,
  shares: 0n,
  failBalance: false,
  hangBalance: false,
  logs: [] as Array<{ transactionHash: `0x${string}` }>,
  minimum: 1_000_000n,
  maximum: 100_000_000n,
  recovered: "0x1111111111111111111111111111111111111111",
}));

vi.mock("server-only", () => ({}));
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      getCode: async () => chain.code,
      getBlockNumber: async () => 123n,
      getLogs: async () => chain.logs,
      readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
        if (functionName === "balanceOf") {
          if (chain.hangBalance) return new Promise<bigint>(() => {});
          if (chain.failBalance) throw new Error("RPC unavailable");
          return address.toLowerCase() === "0x4ce4fa54196f132d928f1ae76db074c14e0203a3" ? chain.shares : chain.balance;
        }
        if (functionName === "minDeposit") return chain.minimum;
        if (functionName === "maxDeposit") return chain.maximum;
        if (functionName === "previewDeposit") return 9_000_000n;
        throw new Error(`Unexpected read: ${functionName}`);
      },
    }),
    recoverMessageAddress: async () => chain.recovered,
  };
});

import { getCrossChainCatalog, getFundedAssets } from "./catalog";
import { parseInput, requestDepositExecution, signatureToAurora, submitSignature } from "./server";
import { depositErrorMessage, parseStoredSession, quoteExpired } from "./session";
import { getDepositStages } from "./progress";
import { GET as statusGET } from "../../app/api/crosschain/status/route";
import { POST as recoveryPOST } from "../../app/api/crosschain/recovery/route";

const account = "0x1111111111111111111111111111111111111111";
const otherAccount = "0x2222222222222222222222222222222222222222";
const sourceId = "base-usdc";
const destinationId = "monad-usdc";
const catalog = {
  result: {
    in: [
      { assetId: sourceId, blockchain: "base", symbol: "USDC", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
      { assetId: "sol-usdc", blockchain: "sol", symbol: "USDC", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
      { assetId: "base-fake", blockchain: "base", symbol: "USDT", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
    ],
    out: [{ assetId: destinationId, blockchain: "monad", symbol: "USDC", contractAddress: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }],
  },
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.AURORA_CROSSCHAIN_ENABLED = "true";
  process.env.AURORA_INTENTS_API_KEY = "test-key";
  chain.code = undefined;
  chain.balance = 0n;
  chain.shares = 0n;
  chain.logs = [];
  chain.failBalance = false;
  chain.hangBalance = false;
  chain.minimum = 1_000_000n;
  chain.maximum = 100_000_000n;
  chain.recovered = account;
  vi.stubGlobal("fetch", vi.fn(async () => reply(catalog)));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("funded USDC discovery", () => {
  it("selects the exact catalog asset and supported EVM chain", async () => {
    const result = await getCrossChainCatalog();
    expect(result.destinationAssetId).toBe(destinationId);
    expect(result.sources.map((item) => item.assetId)).toEqual([sourceId]);
  });

  it("omits zero balances but reports an RPC failure separately", async () => {
    expect(await getFundedAssets(account)).toEqual([]);
    chain.balance = 4_000_000n;
    expect((await getFundedAssets(account))[0]?.balance).toBe("4000000");
    chain.failBalance = true;
    expect((await getFundedAssets(account))[0]).toMatchObject({ balance: null, error: "Balance unavailable" });
  });

  it("finishes discovery when a source RPC never answers", async () => {
    vi.useFakeTimers();
    chain.hangBalance = true;
    const pending = getFundedAssets(account);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(await pending).toMatchObject([{ balance: null, error: "Balance unavailable" }]);
  });
});

describe("fixed vault execution", () => {
  it("binds the share receiver to the connected EOA and checks the net output", async () => {
    let posted: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.body) return reply(catalog);
      posted = JSON.parse(init.body as string) as Record<string, unknown>;
      return reply({ result: { quote: { minAmountOut: "9000000" }, details: { networkFee: "1000" }, steps: posted.steps } });
    }));
    const result = await requestDepositExecution(parseInput({ account, sourceAssetId: sourceId, amount: "10000000" }), true);
    expect(result.minShares).toBe("9000000");
    expect(result.depositAmount).toBe("8998000");
    const steps = posted?.steps as Array<{ parameters: string[] }>;
    expect(steps[0]?.parameters).toEqual(["0x4ce4FA54196F132D928F1ae76db074C14E0203a3", "8998000"]);
    expect(steps[1]?.parameters).toEqual(["8998000", account]);
  });

  it("rejects a changed vault cap before the wallet funds Aurora", async () => {
    chain.maximum = 8_000_000n;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
      init?.body ? reply({ result: { quote: { minAmountOut: "9000000" }, details: { networkFee: "1000" } } }) : reply(catalog)));
    await expect(requestDepositExecution(parseInput({ account, sourceAssetId: sourceId, amount: "10000000" }), true))
      .rejects.toThrow("cannot accept");
  });

  it("applies the vault minimum to the fee-adjusted amount", async () => {
    chain.minimum = 9_000_000n;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
      init?.body ? reply({ result: { quote: { minAmountOut: "9000000" }, details: { networkFee: "1000" } } }) : reply(catalog)));
    await expect(requestDepositExecution(parseInput({ account, sourceAssetId: sourceId, amount: "10000000" }), true))
      .rejects.toThrow("below the vault minimum");
  });

  it("rejects a final quote that cannot fund the vault call and fee", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.body) return reply(catalog);
      calls += 1;
      return reply({ result: { quote: { minAmountOut: calls === 1 ? "9000000" : "8998000" }, details: { networkFee: "1000" } } });
    }));
    await expect(requestDepositExecution(parseInput({ account, sourceAssetId: sourceId, amount: "10000000" }), true))
      .rejects.toThrow("cannot cover the vault deposit");
  });

  it("rejects a contract wallet on source or Monad", async () => {
    chain.code = "0x1234";
    await expect(requestDepositExecution(parseInput({ account, sourceAssetId: sourceId, amount: "10000000" }), true))
      .rejects.toThrow("standard EVM wallets");
  });
});

describe("reload and expiry", () => {
  it("restores only a session belonging to the connected wallet", () => {
    const raw = JSON.stringify({
      account, id: "execution-1", sourceChainId: 8453, sourceToken: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "10000000", depositAddress: "0x3333333333333333333333333333333333333333",
    });
    expect(parseStoredSession(raw, account)?.id).toBe("execution-1");
    expect(parseStoredSession(raw, otherAccount)).toBeNull();
    expect(parseStoredSession("bad-json", account)).toBeNull();
  });

  it("expires quotes at their deadline", () => {
    expect(quoteExpired("2026-09-23T12:00:00Z", Date.parse("2026-09-23T12:00:00Z"))).toBe(true);
    expect(quoteExpired("2026-09-23T12:00:00Z", Date.parse("2026-09-23T11:59:59Z"))).toBe(false);
  });

  it("explains insufficient source gas without losing the saved execution", () => {
    expect(depositErrorMessage(new Error("insufficient funds for gas * price + value"), "Base"))
      .toBe("Not enough source-chain gas on Base to send USDC.");
  });
});

describe("deposit progress", () => {
  it("keeps source funding active until Aurora confirms routing", () => {
    expect(getDepositStages("DEPOSIT_PENDING", "Polygon", true, false).map((step) => step.state))
      .toEqual(["active", "waiting", "waiting", "waiting"]);
    expect(getDepositStages("DEPOSIT_PROCESSING", "Polygon", true, false).map((step) => step.state))
      .toEqual(["complete", "active", "waiting", "waiting"]);
  });

  it("checks the share mint separately from Aurora success", () => {
    expect(getDepositStages("SUCCESS", "Polygon", true, false).map((step) => step.state))
      .toEqual(["complete", "complete", "complete", "active"]);
    expect(getDepositStages("SUCCESS", "Polygon", true, true).map((step) => step.state))
      .toEqual(["complete", "complete", "complete", "complete"]);
  });

  it("shows a vault failure at the vault stage", () => {
    expect(getDepositStages("OPERATION_FAILED", "Polygon", true, false).map((step) => step.state))
      .toEqual(["complete", "complete", "failed", "waiting"]);
  });
});

describe("settlement status with mocked Aurora", () => {
  it("confirms an Aurora success with the vault Deposit event", async () => {
    chain.balance = 12_000n;
    chain.shares = 15_000_000_000_000_000_000n;
    chain.logs = [{ transactionHash: `0x${"ab".repeat(32)}` }];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/intermediary")) return reply({ result: { evm: otherAccount } });
      return reply({ result: [{ id: "execution-1", status: "SUCCESS" }] });
    }));
    const response = await statusGET(new Request(`http://localhost/api/crosschain/status?account=${account}&id=execution-1&startBlock=123`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      execution: { status: "SUCCESS" }, intermediaryBalance: "12000", shares: chain.shares.toString(), mintTxHash: chain.logs[0]?.transactionHash,
    });
  });

  it("reports a failed vault operation and recoverable intermediary USDC", async () => {
    chain.balance = 4_000_000n;
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/intermediary") ? reply({ result: { evm: otherAccount } }) : reply({ result: [{ id: "execution-2", status: "OPERATION_FAILED" }] })));
    const response = await statusGET(new Request(`http://localhost/api/crosschain/status?account=${account}&id=execution-2`));
    expect(await response.json()).toMatchObject({ execution: { status: "OPERATION_FAILED" }, intermediaryBalance: "4000000" });
  });

  it("keeps a refunded source deposit distinct from a vault operation failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ result: [{ id: "execution-3", status: "DEPOSIT_FAILED" }] })));
    const response = await statusGET(new Request(`http://localhost/api/crosschain/status?account=${account}&id=execution-3`));
    expect(await response.json()).toMatchObject({ execution: { status: "DEPOSIT_FAILED" }, intermediaryBalance: null, mintTxHash: null });
  });
});

describe("recoverable USDC", () => {
  it("builds only a wallet-authorized transfer to the same EOA on Monad", async () => {
    chain.balance = 4_000_000n;
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("supported_tokens")) return reply(catalog);
      if (url.includes("/intermediary")) return reply({ result: { evm: otherAccount } });
      if (url.includes("/steps")) {
        posted.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        return reply({ result: { details: { networkFee: "1000" } } });
      }
      return reply({ result: [{ id: "execution-2", status: "OPERATION_FAILED" }] });
    }));
    const response = await recoveryPOST(new Request("http://localhost/api/crosschain/recovery", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "quote", account, id: "execution-2" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ amount: "3998000", fee: "1000" });
    expect(posted[1]?.destinationAsset).toBe(destinationId);
    expect(posted[1]?.steps).toEqual([{ to: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", functionSignature: "transfer(address,uint256)", parameters: [account, "3998000"], value: "0" }]);
  });
});

describe("signature submission", () => {
  it("encodes an EVM signature with Aurora's secp256k1 prefix and recovery bit", () => {
    const value = signatureToAurora(`0x${"11".repeat(64)}1b`);
    expect(value).toMatch(/^secp256k1:[1-9A-HJ-NP-Za-km-z]+$/);
    expect(value).toBe(signatureToAurora(`0x${"11".repeat(64)}00`));
  });

  it("rejects a signature from a different account", async () => {
    chain.recovered = otherAccount;
    vi.stubGlobal("fetch", vi.fn(async () => reply({ result: [{ id: "12345678", details: { payload: { payload_json: "verbatim", standard: "erc191" } } }] })));
    await expect(submitSignature(account, "12345678", `0x${"11".repeat(64)}1b`))
      .rejects.toThrow("does not match");
  });
});
