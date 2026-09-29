import { randomBytes, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { env } from "../config.js";
import { collection, collections, mongoConfigured } from "../lib/mongo.js";

/**
 * Who may drive a Perpl account through this backend.
 *
 * The Ed25519 keys that actually trade never leave the server, so the only question here is
 * whether the caller is one of the addresses in PERPL_MANAGERS. They prove it by signing a
 * single-use challenge with that address, and get a bearer token good for a day in return.
 *
 * Sessions are held in memory and, when storage is configured, mirrored to it. Without that mirror
 * every backend restart signs everyone out, which in development happens on each file save and
 * looks exactly like a broken login.
 */

export const NONCE_TTL_MS = 5 * 60_000;
export const TOKEN_TTL_MS = 24 * 60 * 60_000;

interface Challenge {
  address: string;
  expiresAt: number;
  /** The exact text handed to the wallet. Verification must not rebuild it and risk drifting. */
  message: string;
}

interface Session {
  address: string;
  expiresAt: number;
}

const challenges = new Map<string, Challenge>();
const sessions = new Map<string, Session>();

interface SessionDoc {
  _id: string;
  address: string;
  expiresAt: number;
}

/** Best effort: a session that cannot be persisted still works until the process restarts. */
async function persist(token: string, session: Session): Promise<void> {
  if (!mongoConfigured()) return;
  try {
    const docs = await collection<SessionDoc>(collections.sessions);
    await docs.updateOne(
      { _id: token },
      { $set: { address: session.address, expiresAt: session.expiresAt } },
      { upsert: true },
    );
  } catch {
    // Not fatal: the in-memory copy is still authoritative for this process.
  }
}

async function forget(token: string): Promise<void> {
  if (!mongoConfigured()) return;
  try {
    const docs = await collection<SessionDoc>(collections.sessions);
    await docs.deleteOne({ _id: token });
  } catch {
    // The in-memory delete has already happened.
  }
}

const lower = (a: string) => a.toLowerCase();

export function allowedManagers(): string[] {
  return env.PERPL_MANAGERS;
}

export function isAllowed(address: string): boolean {
  return env.PERPL_MANAGERS.some((m) => lower(m) === lower(address));
}

function sweep(now: number): void {
  for (const [k, v] of challenges) if (v.expiresAt <= now) challenges.delete(k);
  for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k);
}

/** What a signature is being asked for, so the wallet prompt says the true thing. */
export const PURPOSE = {
  perp: {
    title: "DeltaMon perp console",
    intent: "Sign in to trade this Perpl account.",
  },
  automation: {
    title: "DeltaMon automation",
    intent: "Sign in as the vault admin to change what the vault does automatically.",
  },
} as const;

export type Purpose = keyof typeof PURPOSE;

/**
 * The exact text the wallet is asked to sign. It names the audience and the moment, so a signature
 * taken for one purpose cannot be replayed against another.
 */
export function challengeMessage(
  address: string,
  nonce: string,
  issuedAt: string,
  purpose: Purpose = "perp",
): string {
  return [
    PURPOSE[purpose].title,
    "",
    PURPOSE[purpose].intent,
    "This signature costs nothing and sends no transaction.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
    `Valid for: ${NONCE_TTL_MS / 60_000} minutes`,
  ].join("\n");
}

export interface IssuedChallenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

export function createChallenge(
  address: string,
  now = Date.now(),
  purpose: Purpose = "perp",
): IssuedChallenge {
  sweep(now);
  const nonce = randomBytes(16).toString("base64url");
  const issuedAt = new Date(now).toISOString();
  const message = challengeMessage(address, nonce, issuedAt, purpose);
  challenges.set(nonce, { address: lower(address), expiresAt: now + NONCE_TTL_MS, message });
  return { nonce, message, expiresAt: new Date(now + NONCE_TTL_MS).toISOString() };
}

export interface AllowRule {
  check: (address: string) => boolean | Promise<boolean>;
  /** What to tell an address that is refused. */
  reason: string;
}

export const MANAGERS_MAY_SIGN_IN: AllowRule = {
  check: isAllowed,
  reason: "address is not in PERPL_MANAGERS",
};

export type VerifyResult =
  | { ok: true; token: string; address: string; expiresAt: string }
  | { ok: false; reason: string };

/**
 * Checks a signature against a live challenge and mints a session. The nonce is consumed either
 * way, so a failed attempt cannot be retried against the same challenge.
 *
 * `allow` decides who may hold a session, and carries the sentence to show when it says no. It
 * defaults to the PERPL_MANAGERS list; the automation passes a stricter one, so signing in there
 * requires the vault's own admin.
 */
export async function verifyChallenge(
  address: string,
  nonce: string,
  signature: Hex,
  now = Date.now(),
  allow: AllowRule = MANAGERS_MAY_SIGN_IN,
): Promise<VerifyResult> {
  sweep(now);
  const challenge = challenges.get(nonce);
  challenges.delete(nonce);
  if (!challenge) return { ok: false, reason: "unknown or expired challenge" };
  if (challenge.address !== lower(address)) return { ok: false, reason: "challenge is for another address" };
  if (!(await allow.check(address))) return { ok: false, reason: allow.reason };

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: challenge.message, signature });
  } catch {
    return { ok: false, reason: "signature could not be read" };
  }
  if (lower(recovered) !== lower(address)) return { ok: false, reason: "signature does not match" };

  const token = randomBytes(32).toString("base64url");
  const session = { address: lower(address), expiresAt: now + TOKEN_TTL_MS };
  sessions.set(token, session);
  await persist(token, session);
  return {
    ok: true,
    token,
    address,
    expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
  };
}

/**
 * The address behind a bearer token, or null. The in-memory copy is compared in constant time;
 * a token this process has not seen is looked up in storage, which is how a session survives a
 * restart.
 */
export async function sessionFor(token: string | undefined, now = Date.now()): Promise<Session | null> {
  if (!token) return null;
  sweep(now);
  for (const [known, session] of sessions) {
    const a = Buffer.from(known);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return session;
  }
  if (!mongoConfigured()) return null;
  try {
    const docs = await collection<SessionDoc>(collections.sessions);
    const found = await docs.findOne({ _id: token });
    if (!found || found.expiresAt <= now) return null;
    const session = { address: found.address, expiresAt: found.expiresAt };
    sessions.set(token, session); // cached, so the next call stays in memory
    return session;
  } catch {
    return null;
  }
}

export async function revoke(token: string): Promise<void> {
  sessions.delete(token);
  await forget(token);
}

export function bearerFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}

/** Test seam: forget every challenge and session. */
export function resetAuthState(): void {
  challenges.clear();
  sessions.clear();
}
