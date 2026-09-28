import { randomBytes, timingSafeEqual } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { env } from "../config.js";

/**
 * Who may drive a Perpl account through this backend.
 *
 * The Ed25519 keys that actually trade never leave the server, so the only question here is
 * whether the caller is one of the addresses in PERPL_MANAGERS. They prove it by signing a
 * single-use challenge with that address, and get a bearer token good for a day in return.
 *
 * Tokens live in memory: a restart signs everyone out, which is the right default for a key that
 * can open and close positions.
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

/**
 * The exact text the wallet is asked to sign. It names the audience and the moment, so a signature
 * taken for one purpose cannot be replayed against another.
 */
export function challengeMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    "DeltaMon perp console",
    "",
    "Sign in to trade this Perpl account.",
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

export function createChallenge(address: string, now = Date.now()): IssuedChallenge {
  sweep(now);
  const nonce = randomBytes(16).toString("base64url");
  const issuedAt = new Date(now).toISOString();
  const message = challengeMessage(address, nonce, issuedAt);
  challenges.set(nonce, { address: lower(address), expiresAt: now + NONCE_TTL_MS, message });
  return { nonce, message, expiresAt: new Date(now + NONCE_TTL_MS).toISOString() };
}

export type VerifyResult =
  | { ok: true; token: string; address: string; expiresAt: string }
  | { ok: false; reason: string };

/**
 * Checks a signature against a live challenge and mints a session. The nonce is consumed either
 * way, so a failed attempt cannot be retried against the same challenge.
 */
export async function verifyChallenge(
  address: string,
  nonce: string,
  signature: Hex,
  now = Date.now(),
): Promise<VerifyResult> {
  sweep(now);
  const challenge = challenges.get(nonce);
  challenges.delete(nonce);
  if (!challenge) return { ok: false, reason: "unknown or expired challenge" };
  if (challenge.address !== lower(address)) return { ok: false, reason: "challenge is for another address" };
  if (!isAllowed(address)) return { ok: false, reason: "address is not in PERPL_MANAGERS" };

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: challenge.message, signature });
  } catch {
    return { ok: false, reason: "signature could not be read" };
  }
  if (lower(recovered) !== lower(address)) return { ok: false, reason: "signature does not match" };

  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { address: lower(address), expiresAt: now + TOKEN_TTL_MS });
  return {
    ok: true,
    token,
    address,
    expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
  };
}

/** The address behind a bearer token, or null. Compared in constant time. */
export function sessionFor(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  sweep(now);
  for (const [known, session] of sessions) {
    const a = Buffer.from(known);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return session;
  }
  return null;
}

export function revoke(token: string): void {
  sessions.delete(token);
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
