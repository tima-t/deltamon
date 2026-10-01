import type { PerplAccount } from "./perplSession.js";
import type { MarketConfig } from "./perplOrders.js";
import { describePosition } from "./perpPositionView.js";
import type { PerpBook } from "./perpBook.js";

/**
 * The perp book as the live Perpl socket sees it, in the shape the vault stats and the keeper
 * already consume. This replaces the PERP_BOOK_URL document whenever the socket is connected:
 * the backend now holds the account itself, so there is nothing to publish and re-read.
 *
 * Getting equity right matters more than anything else here, because the keeper marks the vault
 * from it: `pnl = equity - deployed`. Count it short and the vault records a loss that never
 * happened.
 */

const USDC = 1_000_000;

export interface ExposureResult {
  book: PerpBook | null;
  /** Why there is no book, for the log. */
  reason?: string;
}

/**
 * Equity is the free balance plus, for every position, the collateral it holds and whatever it has
 * made or lost since entry.
 *
 * Collateral committed to a position leaves the free balance entirely: a real account showed 0.005
 * free against 21.7 inside the position. Reading only the free balance would have marked the whole
 * book as a total loss.
 *
 * @param market Perpl's MON market, for the decimals and the mark. Null withholds the book rather
 *               than valuing positions at a guess.
 */
export function livePerpBook(
  account: PerplAccount,
  monPriceUsd: number,
  market: MarketConfig | null,
  nowSec = Math.floor(Date.now() / 1000),
): ExposureResult {
  if (!account.connected) return { book: null, reason: "socket not connected" };
  const free = money(account.availableBalance);
  const locked = money(account.lockedBalance);
  if (free === null || locked === null) return { book: null, reason: "no balance reported yet" };
  if (account.positions.length > 0 && !market) {
    return { book: null, reason: "no market data to value the positions with" };
  }

  let positionValue = 0;
  let shortMon = 0;
  for (const position of account.positions) {
    const view = describePosition(position.raw, market!);
    // A position that cannot be valued is not the same as no position. Marking around it would
    // report an equity the account does not have.
    if (view.collateralUsd === null) {
      return { book: null, reason: "a position's collateral could not be read" };
    }
    positionValue += view.collateralUsd + (view.unrealisedPnlUsd ?? 0);

    if (view.side === "short" && view.market === market!.id) {
      if (view.size === null) return { book: null, reason: "a short's size could not be read" };
      shortMon += Math.abs(view.size);
    }
  }

  if (!Number.isFinite(monPriceUsd) || monPriceUsd <= 0) {
    return { book: null, reason: "no MON price" };
  }

  const equity = BigInt(Math.round((free + locked + positionValue) * USDC));
  if (equity < 0n) return { book: null, reason: "equity came out negative" };

  return {
    book: {
      equity,
      asOfSec: BigInt(nowSec),
      // Priced with the vault's own Chainlink MON/USD, so the long and the short on the Balance
      // Engine are measured against one price and their difference means something.
      shortNotional: BigInt(Math.round(shortMon * monPriceUsd * USDC)),
    },
  };
}

/** A decimal-string balance in whole units, or null when it is not one. */
function money(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n / USDC : null;
}
