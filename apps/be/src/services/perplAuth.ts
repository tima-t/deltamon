import { createHash, randomBytes } from "node:crypto";
import * as ed from "@noble/ed25519";

/**
 * Perpl request signing. Both the REST calls and the trading socket sign a newline-joined
 * canonical string with the Ed25519 key produced by `pnpm --filter @deltamon/be perpl:enroll`.
 * The opaque token identifies the key; the signature proves we hold it.
 *
 * Docs: https://github.com/PerplFoundation/api-docs (authentication.md)
 */

export interface PerplCredentials {
  /** Opaque token from enrolment. Shown once, cannot be re-derived. */
  apiKey: string;
  /** Ed25519 private key, 0x-prefixed hex. Generated locally; Perpl only ever saw the public half. */
  secret: string;
}

/** Six lines: chain, method, target, timestamp, nonce, body hash. */
export function restCanonical(
  chainId: number,
  method: string,
  target: string,
  timestampMs: string,
  nonce: string,
  bodyHashHex: string,
): string {
  return [String(chainId), method.toUpperCase(), target, timestampMs, nonce, bodyHashHex].join("\n");
}

/** Four lines. The literal domain string separates a socket sign-in from any REST target. */
export function wsSigninCanonical(chainId: number, timestampMs: string, nonce: string): string {
  return [String(chainId), "trading-ws-signin", timestampMs, nonce].join("\n");
}

export function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** 16 random bytes, base64url, unpadded. */
export function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

export function nowMs(): string {
  return String(Date.now());
}

/** Ed25519 over the canonical string, base64url and unpadded, as the header wants it. */
export async function signCanonical(secret: string, canonical: string): Promise<string> {
  const key = secret.startsWith("0x") ? secret.slice(2) : secret;
  const signature = await ed.signAsync(Buffer.from(canonical, "utf8"), Buffer.from(key, "hex"));
  return Buffer.from(signature).toString("base64url");
}

export interface SignedHeaders {
  "X-API-Key": string;
  "X-API-Timestamp": string;
  "X-API-Nonce": string;
  "X-API-Signature": string;
}

/**
 * The signed target is the path relative to the API mount, not the path as the URL spells it:
 * https://app.perpl.xyz/api/v1/trading/fills signs "/v1/trading/fills". Signing the "/api" prefix
 * too is accepted by the transport and refused by the signature check, which reads as a plain 401.
 */
export function signingTarget(url: string, baseUrl: string): string {
  const { pathname, search } = new URL(url);
  const prefix = new URL(baseUrl).pathname.replace(/\/$/, "");
  const path = prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  return `${path || "/"}${search}`;
}

/** Headers for one authenticated REST call. */
export async function restHeaders(
  creds: PerplCredentials,
  chainId: number,
  method: string,
  url: string,
  body: string,
  baseUrl: string,
): Promise<SignedHeaders> {
  const timestamp = nowMs();
  const nonce = newNonce();
  const canonical = restCanonical(
    chainId,
    method,
    signingTarget(url, baseUrl),
    timestamp,
    nonce,
    sha256Hex(body),
  );
  return {
    "X-API-Key": creds.apiKey,
    "X-API-Timestamp": timestamp,
    "X-API-Nonce": nonce,
    "X-API-Signature": await signCanonical(creds.secret, canonical),
  };
}

/** The ApiKeySignIn frame, which must be the first message on the trading socket. */
export async function signinFrame(
  creds: PerplCredentials,
  chainId: number,
): Promise<Record<string, unknown>> {
  const timestamp = nowMs();
  const nonce = newNonce();
  const signature = await signCanonical(creds.secret, wsSigninCanonical(chainId, timestamp, nonce));
  return {
    mt: 29,
    chain_id: chainId,
    api_key: creds.apiKey,
    timestamp,
    nonce,
    signature,
  };
}

export async function signedFetch(
  creds: PerplCredentials,
  chainId: number,
  url: string,
  init: { method?: string; body?: unknown; timeoutMs?: number; baseUrl?: string } = {},
): Promise<unknown> {
  const method = init.method ?? "GET";
  const body = init.body === undefined ? "" : JSON.stringify(init.body);
  const headers = await restHeaders(creds, chainId, method, url, body, init.baseUrl ?? url);
  const res = await fetch(url, {
    method,
    headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(init.timeoutMs ?? 8_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Perpl ${method} ${new URL(url).pathname} ${res.status}: ${text}`);
  return text === "" ? null : (JSON.parse(text) as unknown);
}
