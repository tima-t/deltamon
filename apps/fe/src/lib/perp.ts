import { clearSession, currentToken } from "./perpSession";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * The console's client for the backend's Perpl broker. No credentials pass through here: the
 * backend holds the Ed25519 key for each manager and this only ever names an address.
 */

/** Everything the backend worked out from the raw position and the market it trades in. */
export interface PositionView {
  positionId: string | null;
  market: number | null;
  marketName: string | null;
  side: "long" | "short" | null;
  size: number | null;
  entryPrice: number | null;
  markPrice: number | null;
  notionalUsd: number | null;
  collateralUsd: number | null;
  leverage: number | null;
  unrealisedPnlUsd: number | null;
  realisedFundingUsd: number | null;
  unrealisedFundingUsd: number | null;
  fundingAccruedUsd: number | null;
  fundingRate: number | null;
  fundingRateAnnualised: number | null;
  fundingIntervalSec: number | null;
  nextFundingAtMs: number | null;
  liquidationPrice: number | null;
  liquidationBuffer: number | null;
  maintenanceMargin: number | null;
}

export interface PerpPosition {
  market: number | null;
  size: string | null;
  side: "long" | "short" | null;
  entryPrice: string | null;
  collateral: string | null;
  unrealisedPnl: string | null;
  view?: PositionView;
}

export interface PerpAccount {
  connected: boolean;
  forwarding: boolean | null;
  availableBalance: string | null;
  lockedBalance: string | null;
  marginUtilizationPct: number | null;
  positions: PerpPosition[];
  openOrders: number;
  updatedAt: string | null;
  lastError: string | null;
  /** Perpl's numeric account id. */
  accountId: number | null;
  /** The account the shared key trades, as Perpl reports it. */
  accountAddress: string | null;
  blockHeight: number | null;
}

export class PerpApiError extends Error {}
/** The session is gone or was never there. The panel shows the sign-in card rather than an error. */
export class PerpAuthError extends PerpApiError {}

/**
 * Longer than the backend's own wait for a Perpl acknowledgement, so a slow exchange surfaces as
 * the exchange's answer rather than as "the backend is not answering".
 */
const TIMEOUT_MS = 20_000;

async function call(path: string, init?: RequestInit & { anonymous?: boolean }): Promise<unknown> {
  const token = init?.anonymous ? null : currentToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: {
        // Only when there is a body: Fastify rejects an empty one that claims to be JSON.
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // An abort is the request taking too long, which is a different problem from a dead backend.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new PerpApiError(
        "The request timed out waiting for Perpl. It may still have gone through: check the position before retrying.",
      );
    }
    throw new PerpApiError(`The backend is not answering at ${API_URL}. Is apps/be running?`);
  }
  const text = await res.text();
  const body: unknown = text === "" ? null : JSON.parse(text);
  if (res.status === 401) {
    // Expired or revoked server side. Drop it so the panel asks for a fresh signature.
    clearSession();
    throw new PerpAuthError("Your perp session has expired. Sign in again.");
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `request failed (${res.status})`;
    throw new PerpApiError(message);
  }
  return body;
}

export const fetchPerpAccount = () => call("/perp/account") as Promise<PerpAccount>;

export interface OpenShortInput {
  size: string;
  /** Hundredths, so 10x is 1000. Perpl requires it on every order. */
  leverage?: number;
  stopLoss?: string;
  takeProfit?: string;
}

export const openShort = (input: OpenShortInput) =>
  call("/perp/short", { method: "POST", body: JSON.stringify(input) }) as Promise<{
    sent: number;
    requestIds: number[];
    market: string;
  }>;

export const closeShort = (size: string) =>
  call("/perp/short/close", {
    method: "POST",
    body: JSON.stringify({ size }),
  }) as Promise<{ sent: number; requestIds: number[]; market: string }>;



export interface PerpAccess {
  /** Addresses PERPL_MANAGERS allows to sign in. */
  managers: string[];
  /** Whether the backend holds Perpl credentials at all. */
  configured: boolean;
}

/** Who may sign in, and whether there is an account to trade. Readable without a token. */
export async function fetchPerpAccess(): Promise<PerpAccess> {
  const body = (await call("/perp/auth/allowed", { anonymous: true })) as {
    managers?: unknown;
    configured?: unknown;
  };
  return {
    managers: Array.isArray(body.managers)
      ? body.managers.filter((m): m is string => typeof m === "string")
      : [],
    configured: body.configured === true,
  };
}

export interface Challenge {
  nonce: string;
  message: string;
  expiresAt: string;
}

export const requestChallenge = (address: string) =>
  call("/perp/auth/challenge", {
    method: "POST",
    anonymous: true,
    body: JSON.stringify({ address }),
  }) as Promise<Challenge>;

export const verifySignature = (address: string, nonce: string, signature: string) =>
  call("/perp/auth/verify", {
    method: "POST",
    anonymous: true,
    body: JSON.stringify({ address, nonce, signature }),
  }) as Promise<{ token: string; address: string; expiresAt: string; ttlMs: number }>;

export const signOutPerp = () => call("/perp/auth/signout", { method: "POST" });
