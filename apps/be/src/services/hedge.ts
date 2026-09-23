import { formatUnits } from "viem";
import type { Hedge } from "@deltamon/shared";
import type { PerpBook } from "./perpBook.js";

const MAX_AGE_SEC = 300;
const FUTURE_TOLERANCE_SEC = 30;

/** Only a fresh manager position report can establish measured net MON exposure. */
export function assessHedge(
  longExposureUsd: number,
  vaultValueUsd: number,
  book: PerpBook | null,
  managerCapitalUsd: number,
  managerEquityUsd: number,
  nowSec = Math.floor(Date.now() / 1000),
): Hedge {
  const reportSec = book ? Number(book.asOfSec) : null;
  const validReportTime =
    reportSec !== null &&
    Number.isSafeInteger(reportSec) &&
    reportSec > 0 &&
    reportSec < 8_640_000_000_000;
  const base: Hedge = {
    longExposureUsd,
    shortExposureUsd: null,
    managerCapitalUsd,
    managerEquityUsd,
    netDeltaBps: null,
    reportAsOf: validReportTime ? new Date(reportSec * 1000).toISOString() : null,
    dataStatus: "unavailable",
  };
  if (!book || book.shortNotional === undefined || vaultValueUsd <= 0 || !validReportTime)
    return base;
  const age = nowSec - reportSec;
  if (age < -FUTURE_TOLERANCE_SEC) return base;
  if (age > MAX_AGE_SEC) return { ...base, dataStatus: "stale" };
  const shortExposureUsd = Number(formatUnits(book.shortNotional, 6));
  if (!Number.isFinite(shortExposureUsd) || shortExposureUsd < 0) return base;
  return {
    ...base,
    shortExposureUsd,
    netDeltaBps: Math.round(((longExposureUsd - shortExposureUsd) / vaultValueUsd) * 10_000),
    dataStatus: "fresh",
  };
}
