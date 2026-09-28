"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The console's perp session: an address, a bearer token and when it lapses.
 *
 * The token is minted by the backend against a wallet signature and is good for a day. It is the
 * only credential the browser ever holds; the Ed25519 key that signs Perpl requests stays on the
 * server. Kept in localStorage through an external store so it survives a reload without a
 * set-state-in-effect, and reads as absent on the server.
 */

const KEY = "deltamon.perp.session";

export interface PerpSession {
  address: string;
  token: string;
  /** Unix ms. */
  expiresAt: number;
}

const listeners = new Set<() => void>();
let cached: { raw: string | null; parsed: PerpSession | null } = { raw: null, parsed: null };

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function announce(): void {
  for (const listener of listeners) listener();
}

/** Same object identity for an unchanged string, so useSyncExternalStore does not spin. */
function read(): PerpSession | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === cached.raw) return cached.parsed;
  let parsed: PerpSession | null = null;
  if (raw) {
    try {
      const candidate = JSON.parse(raw) as Partial<PerpSession>;
      if (
        typeof candidate.address === "string" &&
        typeof candidate.token === "string" &&
        typeof candidate.expiresAt === "number"
      ) {
        parsed = candidate as PerpSession;
      }
    } catch {
      parsed = null;
    }
  }
  cached = { raw, parsed };
  return parsed;
}

export function storeSession(session: PerpSession): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Not persisted, but the tab still works until it is closed.
  }
  announce();
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
  announce();
}

/** Read without a hook, for the fetch layer. */
export function currentToken(): string | null {
  if (typeof window === "undefined") return null;
  const session = read();
  if (!session) return null;
  return session.expiresAt > Date.now() ? session.token : null;
}

export function usePerpSession() {
  const session = useSyncExternalStore(subscribe, read, () => null);
  // False on the server and through hydration, so no signed-out flash before storage is readable.
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const signOut = useCallback(() => clearSession(), []);
  return { session, ready, signOut };
}

/**
 * Whether a session is still good. Module level, so the clock is never read during render, which
 * the React Compiler forbids and which would make the component impure.
 */
export function isLive(session: PerpSession | null): boolean {
  return session !== null && session.expiresAt > Date.now();
}

/** Whole hours left, for the banner. */
export function hoursLeft(session: PerpSession | null): number {
  if (!session) return 0;
  return Math.max(0, Math.floor((session.expiresAt - Date.now()) / 3_600_000));
}

/** Whole minutes left, or null when there is no live session. */
export function minutesLeft(session: PerpSession | null): number | null {
  if (!session) return null;
  const ms = session.expiresAt - Date.now();
  return ms > 0 ? Math.floor(ms / 60_000) : null;
}
