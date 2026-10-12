import type { AccountingDaily, VaultAccountingSnapshot } from "@deltamon/shared";
import type { AccountingEvent, FundingObservation } from "./accountingStore.js";

const DAY = 86_400_000;
const YEAR = 365 * DAY;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dollars = (raw: bigint) => Number(raw) / 1_000_000;

/** Effective APY over a fraction of a year, applied to the observed stake, not invented restaking. */
export function estimatedStakingMon(quantity: number, apyBps: number, elapsedMs: number): number {
  if (
    ![quantity, apyBps, elapsedMs].every(Number.isFinite) ||
    quantity < 0 ||
    apyBps < 0 ||
    elapsedMs < 0
  ) {
    throw new Error("invalid staking estimate inputs");
  }
  return quantity * Math.expm1((Math.log1p(apyBps / 10_000) * elapsedMs) / YEAR);
}

/** Account history can mirror the very same funding movement reported by a position event. */
export function reconciledFunding(events: AccountingEvent[], marketId: number): AccountingEvent[] {
  const positions = events.filter(
    (e) => e.stream === "position-history" && e.marketId === marketId && e.fundingRaw !== null,
  );
  const matched = new Set(
    positions.filter((e) => BigInt(e.fundingRaw!) !== 0n).map((e) => `${e.logKey}:${e.positionId}`),
  );
  return events.filter(
    (e) =>
      e.marketId === marketId &&
      e.fundingRaw !== null &&
      (e.stream === "position-history" ||
        (e.stream === "account-history" && !matched.has(`${e.logKey}:${e.positionId}`))),
  );
}

function splitInterval(
  start: number,
  end: number,
  visit: (date: string, duration: number) => void,
): void {
  for (let cursor = start; cursor < end;) {
    const next = Math.min(end, (Math.floor(cursor / DAY) + 1) * DAY);
    visit(dayKey(cursor), next - cursor);
    cursor = next;
  }
}

export interface DailyInputs {
  from: string;
  to: string;
  snapshots: VaultAccountingSnapshot[];
  observations: FundingObservation[];
  events: AccountingEvent[];
  marketId: number | null;
  /** Null until both funding history streams have been completely scanned. */
  fundingThrough: string | null;
  fillsThrough: string | null;
  positionsThrough: string | null;
  historyFrom: string | null;
  maxGapMs: number;
}

export function accountingDaily(input: DailyInputs): AccountingDaily[] {
  const from = Date.parse(input.from),
    to = Date.parse(input.to);
  const byDay = new Map<string, AccountingDaily>();
  const capitalWeighted = new Map<string, number>();
  for (let t = Math.floor(from / DAY) * DAY; t <= to; t += DAY) {
    const date = dayKey(t);
    const historyInRange = !input.historyFrom || t + DAY > Date.parse(input.historyFrom);
    byDay.set(date, {
      date,
      pricePerShareUsd: null,
      vaultReturnPct: null,
      returnSegment: null,
      snapshotAt: null,
      shortBookFresh: null,
      fundingSettledUsd:
        input.fundingThrough && t <= Date.parse(input.fundingThrough) && historyInRange ? 0 : null,
      fundingObservedUsd: null,
      fundingObservedSeconds: 0,
      tradingFeesUsd:
        input.fillsThrough && t <= Date.parse(input.fillsThrough) && historyInRange ? 0 : null,
      realisedTradingPnlUsd:
        input.positionsThrough && t <= Date.parse(input.positionsThrough) && historyInRange
          ? 0
          : null,
      stakingEstimatedMon: null,
      stakingEstimatedUsd: null,
      stakingCoveredSeconds: 0,
      capitalInUseUsd: null,
      capitalCoveredSeconds: 0,
      strategyIncomeEstimatedUsd: null,
      partial: true,
    });
  }
  const snapshots = [...input.snapshots].sort((a, b) => a.at.localeCompare(b.at));
  let baseline: number | null = null,
    segment = 0;
  for (const snapshot of snapshots) {
    const t = Date.parse(snapshot.at);
    if (t < from || t > to) continue;
    const day = byDay.get(dayKey(t));
    if (!day) continue;
    day.snapshotAt = snapshot.at;
    day.shortBookFresh = snapshot.shortBookFresh;
    const price = snapshot.pricePerShareUsd;
    if (snapshot.totalSupplyRaw === "0" || price === null || price <= 0) {
      baseline = null;
      segment++;
      day.pricePerShareUsd = day.vaultReturnPct = day.returnSegment = null;
      continue;
    }
    day.pricePerShareUsd = price;
    // A stale booked short may still affect redemption value, but it cannot establish current return.
    if (!snapshot.shortBookFresh) {
      day.vaultReturnPct = null;
      day.returnSegment = null;
      continue;
    }
    baseline ??= price;
    day.vaultReturnPct = (price / baseline - 1) * 100;
    day.returnSegment = segment;
  }
  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1]!,
      current = snapshots[i]!;
    const start = Date.parse(previous.at),
      end = Date.parse(current.at);
    if (end <= start || end - start > input.maxGapMs) continue;
    splitInterval(Math.max(start, from), Math.min(end, to), (date, ms) => {
      const day = byDay.get(date);
      if (!day) return;
      if (previous.stakingApyBps !== null) {
        const mon = estimatedStakingMon(previous.stakedMon, previous.stakingApyBps, ms);
        day.stakingEstimatedMon = (day.stakingEstimatedMon ?? 0) + mon;
        day.stakingEstimatedUsd = (day.stakingEstimatedUsd ?? 0) + mon * previous.monPriceUsd;
        day.stakingCoveredSeconds += ms / 1000;
      }
      if (previous.shortBookFresh && current.shortBookFresh) {
        const capital = previous.monHeld * previous.monPriceUsd + previous.shortEquityBookedUsd;
        capitalWeighted.set(date, (capitalWeighted.get(date) ?? 0) + (capital * ms) / 1000);
        day.capitalCoveredSeconds += ms / 1000;
      }
    });
  }
  const funding = input.marketId === null ? [] : reconciledFunding(input.events, input.marketId);
  const sums = new Map<string, { funding: bigint; fees: bigint; pnl: bigint }>();
  const addRaw = (event: AccountingEvent, field: "funding" | "fees" | "pnl", raw: string) => {
    const t = Date.parse(event.at);
    if (t < from || t > to) return;
    const key = dayKey(t),
      sum = sums.get(key) ?? { funding: 0n, fees: 0n, pnl: 0n };
    sum[field] += BigInt(raw);
    sums.set(key, sum);
  };
  for (const e of funding) addRaw(e, "funding", e.fundingRaw!);
  for (const e of input.events.filter((e) => e.marketId === input.marketId)) {
    if (e.tradingFeeRaw !== null) addRaw(e, "fees", e.tradingFeeRaw);
    if (e.realisedTradingPnlRaw !== null) addRaw(e, "pnl", e.realisedTradingPnlRaw);
  }
  for (const [date, sum] of sums) {
    const day = byDay.get(date);
    if (!day) continue;
    if (day.fundingSettledUsd !== null) day.fundingSettledUsd = dollars(sum.funding);
    if (day.tradingFeesUsd !== null) day.tradingFeesUsd = dollars(sum.fees);
    if (day.realisedTradingPnlUsd !== null) day.realisedTradingPnlUsd = dollars(sum.pnl);
  }
  // An unattributed account funding event is preserved in storage, but cannot establish MON income.
  const unknown = input.events.filter(
    (e) => e.marketId === null && e.fundingRaw !== null && BigInt(e.fundingRaw) !== 0n,
  );
  for (const event of unknown) {
    const day = byDay.get(event.at.slice(0, 10));
    if (day) day.fundingSettledUsd = null;
  }

  const observations = [...input.observations].sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 1; i < observations.length; i++) {
    const previous = observations[i - 1]!,
      current = observations[i]!;
    const start = Date.parse(previous.at),
      end = Date.parse(current.at);
    if (
      current.scope !== previous.scope ||
      end <= start ||
      end - start > input.maxGapMs ||
      start < from ||
      end > to ||
      !input.fundingThrough ||
      end > Date.parse(input.fundingThrough) ||
      previous.openFundingUsd === null ||
      current.openFundingUsd === null ||
      unknown.some((e) => Date.parse(e.at) > start && Date.parse(e.at) <= end)
    )
      continue;
    let settled = 0n;
    for (const event of funding) {
      const t = Date.parse(event.at);
      if (t > start && t <= end) settled += BigInt(event.fundingRaw!);
    }
    const delta = dollars(settled) + current.openFundingUsd - previous.openFundingUsd;
    // A daily observed change is assigned to the closing observation, not retroactively smoothed.
    const day = byDay.get(dayKey(end));
    if (day) day.fundingObservedUsd = (day.fundingObservedUsd ?? 0) + delta;
    splitInterval(start, end, (date, ms) => {
      const day = byDay.get(date);
      if (day) day.fundingObservedSeconds += ms / 1000;
    });
  }
  for (const day of byDay.values()) {
    if (day.capitalCoveredSeconds > 0)
      day.capitalInUseUsd = capitalWeighted.get(day.date)! / day.capitalCoveredSeconds;
    if (day.stakingEstimatedUsd !== null && day.fundingObservedUsd !== null) {
      day.strategyIncomeEstimatedUsd = day.stakingEstimatedUsd + day.fundingObservedUsd;
    }
    const dayStart = Date.parse(`${day.date}T00:00:00.000Z`);
    // Current days and days with observation gaps remain explicitly partial.
    day.partial =
      to < dayStart + DAY ||
      day.stakingCoveredSeconds < 86_400 ||
      day.fundingObservedSeconds < 86_400 ||
      day.fundingSettledUsd === null ||
      day.tradingFeesUsd === null;
  }
  return [...byDay.values()];
}
