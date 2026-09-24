import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig, http } from "wagmi";
import { connect, getWalletClient, signMessage, switchChain } from "wagmi/actions";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { monadMainnet } from "@deltamon/shared";

const signer = vi.hoisted(() => ({ calls: 0 }));
const key = `0x${"11".repeat(32)}` as const;
const local = privateKeyToAccount(key);

vi.mock("./passkey", () => ({
  passkeyEnabled: () => true,
  readPasskeyRecord: () => ({ address: local.address, credentialId: "test-credential" }),
  withPasskeyAccount: async (_address: string, action: (account: typeof local) => Promise<unknown>) => {
    signer.calls += 1;
    return action(local);
  },
}));

import { meraConnector } from "./meraConnector";

function config() {
  return createConfig({
    chains: [monadMainnet, base],
    connectors: [meraConnector],
    transports: { [monadMainnet.id]: http(), [base.id]: http() },
    ssr: true,
  });
}

beforeEach(() => { signer.calls = 0; });

describe("Mera Wagmi connector", () => {
  it("connects, signs an EIP-191 message, and switches source chains", async () => {
    const app = config();
    await connect(app, { connector: meraConnector, chainId: 143 });
    const signature = await signMessage(app, { message: "Aurora authorization" });
    expect(await recoverMessageAddress({ message: "Aurora authorization", signature })).toBe(local.address);
    expect(signer.calls).toBe(1);
    await switchChain(app, { chainId: base.id });
    const client = await getWalletClient(app);
    expect(client.chain.id).toBe(base.id);
    expect(client.account.address).toBe(local.address);
  });

  it("signs and broadcasts a transaction with a fresh action signer", async () => {
    const app = config();
    await connect(app, { connector: meraConnector, chainId: 143 });
    const broadcast = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(request.body as string) as { method: string; params: string[]; id: number };
      expect(body.method).toBe("eth_sendRawTransaction");
      expect(body.params[0]).toMatch(/^0x/);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: `0x${"ab".repeat(32)}` }), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", broadcast);
    try {
      const client = await getWalletClient(app);
      const hash = await client.sendTransaction({
        to: "0x2222222222222222222222222222222222222222",
        value: 1n,
        gas: 21_000n,
        nonce: 0,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
      });
      expect(hash).toBe(`0x${"ab".repeat(32)}`);
      expect(signer.calls).toBe(1);
      expect(broadcast).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
