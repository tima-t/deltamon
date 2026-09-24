import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoverMessageAddress } from "viem";
import { MeraError } from "@category-labs/mera";

const passkey = vi.hoisted(() => ({
  secret: new Uint8Array(32).fill(7),
  credentialId: "test-credential",
}));

vi.mock("@category-labs/mera", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@category-labs/mera")>();
  return {
    ...actual,
    createPasskeyWithPrfOutput: vi.fn(async () => ({
      credentialId: passkey.credentialId,
      transports: ["internal"],
      prfOutput: new Uint8Array(passkey.secret),
    })),
    getPasskeyPrfOutput: vi.fn(async () => ({
      credentialId: passkey.credentialId,
      prfOutput: new Uint8Array(passkey.secret),
    })),
  };
});

import { createPasskeyWallet, exportPasskeyRecoveryPhrase, passkeyEnabled, passkeyError, readPasskeyRecord, signInPasskeyWallet, withPasskeyAccount } from "./passkey";

let items: Map<string, string>;

beforeEach(() => {
  items = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { hostname: "localhost" },
    isSecureContext: true,
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    },
  });
  process.env.NEXT_PUBLIC_PASSKEY_ENABLED = "true";
  passkey.secret.fill(7);
  passkey.credentialId = "test-credential";
});

describe("Mera account lifecycle", () => {
  it("recovers the same EOA and stores only public credential metadata", async () => {
    const created = await createPasskeyWallet();
    const recovered = await signInPasskeyWallet();
    expect(recovered.address).toBe(created.address);
    expect(readPasskeyRecord()?.address).toBe(created.address);
    const stored = JSON.stringify(readPasskeyRecord());
    expect(stored).not.toContain("privateKey");
    expect(stored).not.toContain("prfOutput");
    expect((await exportPasskeyRecoveryPhrase(created.address)).split(" ")).toHaveLength(24);
  });

  it("discovers the wallet again without local metadata on a new device", async () => {
    const created = await createPasskeyWallet();
    items.clear();
    expect(readPasskeyRecord()).toBeNull();
    expect((await signInPasskeyWallet()).address).toBe(created.address);
  });

  it("signs for the connected address and ends the signing session", async () => {
    const { address } = await createPasskeyWallet();
    let account: Parameters<Parameters<typeof withPasskeyAccount>[1]>[0] | undefined;
    const signature = await withPasskeyAccount(address, async (active) => {
      account = active;
      return active.signMessage({ message: "DeltaMon test" });
    });
    expect(await recoverMessageAddress({ message: "DeltaMon test", signature })).toBe(address);
    await expect(account!.signMessage({ message: "again" })).rejects.toMatchObject({ code: "SESSION_ENDED" });
  });

  it("rejects a different passkey before a financial signature", async () => {
    const { address } = await createPasskeyWallet();
    passkey.secret.fill(9);
    await expect(withPasskeyAccount(address, async (account) => account.signMessage({ message: "deposit" })))
      .rejects.toThrow("different wallet");
  });

  it("rejects a different credential even if it produces the same address", async () => {
    const { address } = await createPasskeyWallet();
    passkey.credentialId = "another-credential";
    await expect(withPasskeyAccount(address, async (account) => account.signMessage({ message: "deposit" })))
      .rejects.toThrow("different passkey");
  });

  it("ends a signing session when the requested action fails", async () => {
    const { address } = await createPasskeyWallet();
    let active: Parameters<Parameters<typeof withPasskeyAccount>[1]>[0] | undefined;
    await expect(withPasskeyAccount(address, async (account) => {
      active = account;
      throw new Error("transaction rejected");
    })).rejects.toThrow("transaction rejected");
    await expect(active!.signMessage({ message: "again" })).rejects.toMatchObject({ code: "SESSION_ENDED" });
  });

  it("disables preview hosts and maps unsupported or cancelled prompts to recoverable copy", () => {
    window.location.hostname = "preview.deltamon.xyz";
    expect(passkeyEnabled()).toBe(false);
    expect(passkeyError(new MeraError("PRF_UNAVAILABLE", "unsupported"))).toContain("connect an existing wallet");
    expect(passkeyError(new MeraError("PASSKEY_OPERATION_FAILED", "cancelled"))).toContain("Try again");
  });
});
