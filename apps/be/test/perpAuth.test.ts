import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const allowed = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

// The allow-list is read off the parsed env, so it is stubbed before the module under test loads.
vi.mock("../src/config.js", () => ({
  env: { PERPL_MANAGERS: [allowed.address] },
  isDev: false,
  isTest: true,
}));

const {
  NONCE_TTL_MS,
  TOKEN_TTL_MS,
  bearerFrom,
  createChallenge,
  isAllowed,
  resetAuthState,
  revoke,
  sessionFor,
  verifyChallenge,
} = await import("../src/services/perpAuth.js");

beforeEach(() => resetAuthState());

const signIn = async (account: typeof allowed, now = Date.now()) => {
  const challenge = createChallenge(account.address, now);
  const signature = await account.signMessage({ message: challenge.message });
  return { challenge, signature };
};

describe("the allow list", () => {
  it("knows who may sign in, whatever the casing", () => {
    expect(isAllowed(allowed.address)).toBe(true);
    expect(isAllowed(allowed.address.toLowerCase())).toBe(true);
    expect(isAllowed(stranger.address)).toBe(false);
  });
});

describe("signing in", () => {
  it("mints a token for a good signature from a listed address", async () => {
    const { challenge, signature } = await signIn(allowed);
    const result = await verifyChallenge(allowed.address, challenge.nonce, signature);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await sessionFor(result.token))?.address).toBe(allowed.address.toLowerCase());
    expect(Date.parse(result.expiresAt) - Date.now()).toBeGreaterThan(TOKEN_TTL_MS - 5_000);
  });

  it("refuses a signature from a different key", async () => {
    const challenge = createChallenge(allowed.address);
    const forged = await stranger.signMessage({ message: challenge.message });
    const result = await verifyChallenge(allowed.address, challenge.nonce, forged);
    expect(result).toMatchObject({ ok: false, reason: "signature does not match" });
  });

  it("refuses an address that is not listed, even with its own valid signature", async () => {
    const { challenge, signature } = await signIn(stranger);
    const result = await verifyChallenge(stranger.address, challenge.nonce, signature);
    expect(result).toMatchObject({ ok: false, reason: "address is not in PERPL_MANAGERS" });
  });

  it("burns the challenge, so one signature cannot be replayed", async () => {
    const { challenge, signature } = await signIn(allowed);
    expect((await verifyChallenge(allowed.address, challenge.nonce, signature)).ok).toBe(true);
    const replay = await verifyChallenge(allowed.address, challenge.nonce, signature);
    expect(replay).toMatchObject({ ok: false, reason: "unknown or expired challenge" });
  });

  it("burns the challenge even when the attempt fails", async () => {
    const challenge = createChallenge(allowed.address);
    const forged = await stranger.signMessage({ message: challenge.message });
    await verifyChallenge(allowed.address, challenge.nonce, forged);
    const retry = await allowed.signMessage({ message: challenge.message });
    expect(await verifyChallenge(allowed.address, challenge.nonce, retry)).toMatchObject({
      ok: false,
      reason: "unknown or expired challenge",
    });
  });

  it("will not let one listed address spend another's challenge", async () => {
    const challenge = createChallenge(stranger.address);
    const signature = await allowed.signMessage({ message: challenge.message });
    expect(await verifyChallenge(allowed.address, challenge.nonce, signature)).toMatchObject({
      ok: false,
      reason: "challenge is for another address",
    });
  });

  it("lets a challenge go stale", async () => {
    const t0 = Date.now();
    const challenge = createChallenge(allowed.address, t0);
    const signature = await allowed.signMessage({ message: challenge.message });
    const late = await verifyChallenge(
      allowed.address,
      challenge.nonce,
      signature,
      t0 + NONCE_TTL_MS + 1,
    );
    expect(late).toMatchObject({ ok: false, reason: "unknown or expired challenge" });
  });

  it("rejects a malformed signature rather than throwing", async () => {
    const challenge = createChallenge(allowed.address);
    const result = await verifyChallenge(allowed.address, challenge.nonce, "0x00");
    expect(result.ok).toBe(false);
  });
});

describe("the token", () => {
  it("expires after a day and can be revoked before that", async () => {
    const { challenge, signature } = await signIn(allowed);
    const result = await verifyChallenge(allowed.address, challenge.nonce, signature);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await sessionFor(result.token, Date.now() + TOKEN_TTL_MS - 1_000)).not.toBeNull();
    expect(await sessionFor(result.token, Date.now() + TOKEN_TTL_MS + 1)).toBeNull();

    const second = await signIn(allowed);
    const again = await verifyChallenge(allowed.address, second.challenge.nonce, second.signature);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    await revoke(again.token);
    expect(await sessionFor(again.token)).toBeNull();
  });

  it("knows nothing of a token it never issued", async () => {
    expect(await sessionFor("not-a-token")).toBeNull();
    expect(await sessionFor(undefined)).toBeNull();
  });
});

describe("the authorization header", () => {
  it("reads a bearer token and ignores anything else", () => {
    expect(bearerFrom("Bearer abc")).toBe("abc");
    expect(bearerFrom("bearer abc")).toBe("abc");
    expect(bearerFrom("Basic abc")).toBeUndefined();
    expect(bearerFrom("Bearer")).toBeUndefined();
    expect(bearerFrom(undefined)).toBeUndefined();
  });
});

describe("what the wallet is asked to sign", () => {
  it("says which console the signature is for", () => {
    const perp = createChallenge(allowed.address);
    expect(perp.message).toContain("DeltaMon perp console");
    expect(perp.message).toContain("trade this Perpl account");
  });

  it("tells an admin they are authorising the automation, not a trade", () => {
    const admin = createChallenge(allowed.address, Date.now(), "automation");
    expect(admin.message).toContain("DeltaMon automation");
    expect(admin.message).toContain("change what the vault does automatically");
    expect(admin.message).not.toContain("trade this Perpl account");
  });

  it("still verifies against the exact text that was issued", async () => {
    const challenge = createChallenge(allowed.address, Date.now(), "automation");
    const signature = await allowed.signMessage({ message: challenge.message });
    expect((await verifyChallenge(allowed.address, challenge.nonce, signature)).ok).toBe(true);
  });
});
