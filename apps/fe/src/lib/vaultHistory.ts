import type { AccountingDaily, VaultAccountingHistory, VaultStats } from "@deltamon/shared";

export type FundingView = "observed" | "settled";
export const DAY_SECONDS = 86_400;

export function historyMatchesVault(
  history: VaultAccountingHistory,
  stats: Pick<VaultStats, "vault" | "chainId" | "source"> | null,
): boolean {
  if (!stats) return true;
  return (
    stats.source === "onchain" &&
    stats.vault?.toLowerCase() === history.vault?.toLowerCase() &&
    stats.chainId === history.chainId
  );
}

/**
 * Whether a day carries an observation the charts draw: a vault snapshot, observed funding or a
 * staking estimate. Venue settlements are deliberately excluded — a single backfilled payment
 * weeks before collection began would otherwise anchor the axis to a stretch with nothing to
 * plot, which is the whole problem this is here to avoid. What it hides is reported instead,
 * see `settledBefore`.
 */
export function hasReading(day: AccountingDaily): boolean {
  return (
    day.snapshotAt !== null ||
    day.fundingObservedUsd !== null ||
    day.stakingEstimatedUsd !== null
  );
}

/**
 * Drop the leading stretch of days with nothing to plot. A vault a few days old would otherwise
 * draw its whole history into the last few pixels of a thirty-day axis. Trailing days stay: the
 * gap between the last reading and today is information.
 */
export function trimToRecorded(days: AccountingDaily[]): AccountingDaily[] {
  const first = days.findIndex(hasReading);
  return first <= 0 ? days : days.slice(first);
}

/**
 * Settled funding and fees on the days the axis leaves out. Backfilled venue history can predate
 * collection, and dropping those days from the plot must not drop them from the account.
 */
export function settledBefore(days: AccountingDaily[]): { funding: number; fees: number } | null {
  const first = days.findIndex(hasReading);
  if (first <= 0) return null;
  let funding = 0;
  let fees = 0;
  for (const day of days.slice(0, first)) {
    funding += day.fundingSettledUsd ?? 0;
    fees += day.tradingFeesUsd ?? 0;
  }
  return funding === 0 && fees === 0 ? null : { funding, fees };
}

export function fundingValue(day: AccountingDaily, view: FundingView): number | null {
  return view === "settled" ? day.fundingSettledUsd : day.fundingObservedUsd;
}

export function incomeValue(day: AccountingDaily, view: FundingView): number | null {
  const funding = fundingValue(day, view);
  return funding === null || day.stakingEstimatedUsd === null
    ? null
    : funding + day.stakingEstimatedUsd;
}

export interface CumulativeIncomePoint {
  index: number;
  value: number;
  funding: number;
  staking: number;
  partial: boolean;
}

/** Sum recorded earned funding and estimated staking only; missing sources never become zero. */
export function cumulativeIncome(days: AccountingDaily[]): (CumulativeIncomePoint | null)[] {
  let funding = 0;
  let staking = 0;
  let partial = false;
  return days.map((day, index) => {
    const income = incomeValue(day, "observed");
    if (income === null) {
      partial = true;
      return null;
    }
    funding += day.fundingObservedUsd!;
    staking += day.stakingEstimatedUsd!;
    partial ||= day.stakingCoveredSeconds < DAY_SECONDS || day.fundingObservedSeconds < DAY_SECONDS;
    return { index, value: funding + staking, funding, staking, partial };
  });
}

export interface StrategyReturnPoint {
  index: number;
  /** Income earned to this day as a percentage of the vault's total USDC value. */
  value: number;
  incomeUsd: number;
  partial: boolean;
}

/**
 * Strategy return: funding plus estimated staking earned to date over the vault's own value,
 * which is one `totalAssets()` read the collector already records. It answers "what has the
 * strategy produced on the money at work", a different question from the contract's book value
 * per share, and it is the headline the vault page shows.
 *
 * It deliberately excludes price PnL and trading fees, so it is not a depositor's net return and
 * must always be labelled as strategy income. It is positive whenever cumulative income is
 * positive; a genuinely negative cumulative funding total still reads negative, because flooring
 * it at zero would report a loss as breakeven.
 */
export function strategyReturn(
  days: AccountingDaily[],
  capitalUsd: number | null,
  view: FundingView = "observed",
): (StrategyReturnPoint | null)[] {
  if (!capitalUsd || capitalUsd <= 0) return days.map(() => null);
  let income = 0;
  let seen = false;
  let partial = false;
  return days.map((day, index) => {
    const funding = fundingValue(day, view);
    // Either component on its own is still real income; a missing one is excluded, not zeroed.
    if (funding === null && day.stakingEstimatedUsd === null) {
      if (seen) partial = true;
      return seen ? { index, value: (income / capitalUsd) * 100, incomeUsd: income, partial } : null;
    }
    seen = true;
    income += (funding ?? 0) + (day.stakingEstimatedUsd ?? 0);
    partial ||=
      funding === null ||
      day.stakingEstimatedUsd === null ||
      day.fundingObservedSeconds < DAY_SECONDS ||
      day.stakingCoveredSeconds < DAY_SECONDS;
    return { index, value: (income / capitalUsd) * 100, incomeUsd: income, partial };
  });
}

/** Contiguous paths, so a day with no reading at all leaves a gap rather than a straight line. */
export function strategyRuns(points: (StrategyReturnPoint | null)[]): StrategyReturnPoint[][] {
  const runs: StrategyReturnPoint[][] = [];
  let previousIndex = -2;
  for (const point of points) {
    if (!point) continue;
    if (point.index !== previousIndex + 1) runs.push([]);
    runs[runs.length - 1]!.push(point);
    previousIndex = point.index;
  }
  return runs;
}

export function incomeRuns(points: (CumulativeIncomePoint | null)[]): CumulativeIncomePoint[][] {
  const runs: CumulativeIncomePoint[][] = [];
  let previousIndex = -2;
  for (const point of points) {
    if (!point) continue;
    if (point.index !== previousIndex + 1) runs.push([]);
    runs[runs.length - 1]!.push(point);
    previousIndex = point.index;
  }
  return runs;
}

export function recordedReturn(day: AccountingDaily): number | null {
  return day.shortBookFresh && day.pricePerShareUsd !== null && day.pricePerShareUsd > 0
    ? day.vaultReturnPct
    : null;
}

/** Separate paths preserve missing days and restarts after zero share supply. */
export function returnRuns(days: AccountingDaily[]): { index: number; value: number }[][] {
  const runs: { index: number; value: number }[][] = [];
  let previousSegment: number | null = null;
  let previousIndex = -2;
  for (const [index, day] of days.entries()) {
    const value = recordedReturn(day);
    if (value === null || day.returnSegment === null) continue;
    if (index !== previousIndex + 1 || day.returnSegment !== previousSegment) runs.push([]);
    runs[runs.length - 1]!.push({ index, value });
    previousSegment = day.returnSegment;
    previousIndex = index;
  }
  return runs;
}

export function compositionSlices(history: VaultAccountingHistory) {
  const c = history.composition;
  if (!c) return null;
  const slices = [
    { id: "mon", label: "MON holdings", value: c.monHoldingsUsd },
    { id: "short", label: "Short-account equity", value: c.shortEquityBookedUsd },
    { id: "usd", label: "USD", value: c.idleUsdcUsd + c.idleAusdUsd },
  ];
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  // Pie area cannot represent a negative asset or a mismatched accounting total.
  const chartable =
    [c.idleUsdcUsd, c.idleAusdUsd].every((value) => Number.isFinite(value) && value >= 0) &&
    slices.every((slice) => Number.isFinite(slice.value) && slice.value >= 0) &&
    (!history.latest ||
      Math.abs(total - history.latest.grossAssetsUsd) <= Math.max(0.02, total * 0.0001));
  return { slices, total, chartable };
}

const money = (value: number, digits: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

/** Small live-vault earnings must not disappear into a rounded $0. */
export function historyUsd(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const absolute = Math.abs(value);
  const digits = absolute > 0 && absolute < 0.01 ? 6 : absolute < 1 && absolute > 0 ? 4 : 2;
  return `${value < 0 ? "−" : signed && value > 0 ? "+" : ""}${money(absolute, digits)}`;
}

export function historyPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits = Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 4 : 2;
  return `${value < 0 ? "−" : value > 0 ? "+" : ""}${Math.abs(value).toFixed(digits)}%`;
}

export function historyDate(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

export function coverageLabel(seconds: number): string {
  if (seconds >= DAY_SECONDS) return "Full day";
  if (seconds < 60) return `${Math.round(seconds)}s recorded`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m recorded`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m recorded`;
}
