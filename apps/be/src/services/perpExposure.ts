import type { PerplAccount, PerplPosition } from "./perplSession.js";
import type { PerpBook } from "./perpBook.js";

/**
 * The perp book as the live Perpl socket sees it, in the shape the vault stats and the keeper
 * already consume. This replaces the PERP_BOOK_URL document whenever the socket is connected:
 * the backend now holds the account itself, so there is nothing to publish and re-read.
 *
 * Notional is priced with the vault's own Chainlink MON/USD rather than Perpl's mark, so the long
 * and the short on the Balance Engine are measured against one price and their difference means
 * something.
 */

const USDC = 1_000_000;

/** Parses a signed decimal string to a number, or null when it is not one. */
function signed(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface ExposureResult {
  book: PerpBook | null;
  /** Why there is no book, for the log. */
  reason?: string;
}

/**
 * @param monMarketId Perpl's market id for MON. Positions in other markets are not MON exposure.
 */
export function livePerpBook(
  account: PerplAccount,
  monPriceUsd: number,
  monMarketId: number | null,
  nowSec = Math.floor(Date.now() / 1000),
): ExposureResult {
  if (!account.connected) return { book: null, reason: "socket not connected" };
  const available = signed(account.availableBalance);
  const locked = signed(account.lockedBalance);
  if (available === null || locked === null) {
    return { book: null, reason: "no balance reported yet" };
  }

  const equity = BigInt(Math.round(available + locked));

  // A position we cannot read is not the same as no position. Reporting zero short against real
  // exposure would paint the vault delta neutral when it is not, so the book is withheld instead.
  let shortMon = 0;
  for (const position of account.positions) {
    const parsed = shortSizeOf(position, monMarketId);
    if (parsed === null) {
      return { book: null, reason: "a position could not be read" };
    }
    shortMon += parsed;
  }

  if (!Number.isFinite(monPriceUsd) || monPriceUsd <= 0) {
    return { book: null, reason: "no MON price" };
  }

  return {
    book: {
      equity,
      asOfSec: BigInt(nowSec),
      shortNotional: BigInt(Math.round(shortMon * monPriceUsd * USDC)),
    },
  };
}

/**
 * MON that this position is short, as a positive number. Longs and other markets contribute
 * nothing. Null means the row was not understood.
 */
export function shortSizeOf(position: PerplPosition, monMarketId: number | null): number | null {
  if (monMarketId !== null && position.market !== null && position.market !== monMarketId) return 0;
  const size = signed(position.size);
  if (size === null) return null;
  if (position.side === "short") return Math.abs(size);
  if (position.side === "long") return 0;
  // No side given: a negative size is the usual way to express a short.
  return size < 0 ? Math.abs(size) : 0;
}
