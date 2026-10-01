import type { PerpBook } from "./perpBook.js";

// Pure decisions for the keeper, kept apart from any RPC so they can be tested directly.

const BPS = 10_000n;
/** Clock skew allowed between the feed's publisher and the chain. */
const FUTURE_TOLERANCE_SEC = 60n;

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

export interface PerpMarkInput {
  /** perpDeployed(), in asset units. */
  deployed: bigint;
  /** perpReportedPnl() */
  reportedPnl: bigint;
  /** perpReportedAt(), unix seconds. Zero once the vault has invalidated the mark. */
  reportedAt: bigint;
  /** perpReportMaxAge(), seconds. */
  maxAgeSec: bigint;
  /** perpPnlBandBps(). The keeper's reports must stay inside it in both directions. */
  bandBps: bigint;
  /** Chain time. */
  nowSec: bigint;
  /** Re-mark early once the book has moved more than this share of what is deployed. */
  minChangeBps: bigint;
  /** Movement cannot trigger a mark more often than this. Staleness and the due clock still do. */
  minRemarkSec: bigint;
  /** A feed older than this is not marked from. */
  maxBookAgeSec: bigint;
  book: PerpBook | null;
}

export type PerpMarkPlan =
  | { kind: "idle" }
  | { kind: "skip"; reason: string; alerts: string[] }
  | { kind: "report"; pnl: bigint; reason: string; alerts: string[] };

/**
 * Decides whether to call reportPerpPnl and with what. It never invents a number: with no feed, or
 * a stale one, it skips and lets the mark go stale, which the vault values conservatively.
 */
export function planPerpMark(i: PerpMarkInput): PerpMarkPlan {
  if (i.deployed === 0n) return { kind: "idle" };
  const age = i.nowSec - i.reportedAt;
  const stale = age > i.maxAgeSec;
  const alerts: string[] = [];

  if (!i.book) {
    if (stale)
      alerts.push("perp mark is stale and there is no perp book feed; deposits stay paused");
    return { kind: "skip", reason: "no perp book feed", alerts };
  }
  const bookAge = i.nowSec - i.book.asOfSec;
  if (bookAge > i.maxBookAgeSec) {
    alerts.push(`perp book feed is ${bookAge}s old; not marking from it`);
    return { kind: "skip", reason: "perp book feed is stale", alerts };
  }
  // A feed stamped ahead of the chain is no more trustworthy than a stale one.
  if (bookAge < -FUTURE_TOLERANCE_SEC) {
    alerts.push(`perp book feed is stamped ${-bookAge}s ahead of the chain; not marking from it`);
    return { kind: "skip", reason: "perp book feed is from the future", alerts };
  }

  const raw = i.book.equity - i.deployed;
  const band = (i.deployed * i.bandBps) / BPS;
  let pnl = raw;
  if (raw > band) {
    pnl = band;
    alerts.push(`perp gain ${raw} is above the band; marked at ${band}, which understates it`);
  } else if (raw < -band) {
    pnl = -band;
    alerts.push(
      `perp loss ${-raw} is past the keeper's band; the admin must mark it with reportPerpPnl(${raw})`,
    );
  }

  // Refresh at half the vault's limit, so a slow tick or a busy RPC never lets the mark lapse.
  if (stale) return { kind: "report", pnl, reason: "mark is stale", alerts };
  if (age * 2n >= i.maxAgeSec) return { kind: "report", pnl, reason: "mark is due", alerts };

  // Movement alone is rate limited. The band is measured against what was deployed, but the book
  // moves with notional, and a levered position crosses 25bps of its collateral on a fraction of
  // a percent of price: a 983 MON short re-marked on every 0.17% tick, hundreds of times a day.
  if (age < i.minRemarkSec) {
    return { kind: "skip", reason: "marked too recently to re-mark on movement", alerts };
  }
  const moved = abs(pnl - i.reportedPnl);
  if (moved > (i.deployed * i.minChangeBps) / BPS) {
    return { kind: "report", pnl, reason: `book moved ${moved}`, alerts };
  }
  return { kind: "skip", reason: "mark is fresh and the book has not moved", alerts };
}
