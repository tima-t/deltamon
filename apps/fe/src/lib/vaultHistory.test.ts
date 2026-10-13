import { describe, expect, it } from "vitest";
import {
  VaultAccountingHistorySchema,
  AccountingDailySchema,
  type AccountingDaily,
} from "@deltamon/shared";
import {
  compositionSlices,
  cumulativeIncome,
  incomeRuns,
  fundingValue,
  historyMatchesVault,
  historyPercent,
  historyUsd,
  incomeValue,
  recordedReturn,
  returnRuns,
  strategyReturn,
  strategyRuns,
  hasReading,
  trimToRecorded,
  settledBefore,
} from "./vaultHistory";

function day(date: string, overrides: Partial<AccountingDaily> = {}): AccountingDaily {
  return AccountingDailySchema.parse({
    date,
    pricePerShareUsd: 1,
    vaultReturnPct: 0,
    returnSegment: 0,
    snapshotAt: `${date}T12:00:00.000Z`,
    shortBookFresh: true,
    fundingSettledUsd: null,
    fundingObservedUsd: null,
    fundingObservedSeconds: 0,
    tradingFeesUsd: null,
    realisedTradingPnlUsd: null,
    stakingEstimatedMon: null,
    stakingEstimatedUsd: null,
    stakingCoveredSeconds: 0,
    capitalInUseUsd: null,
    capitalCoveredSeconds: 0,
    strategyIncomeEstimatedUsd: null,
    partial: true,
    ...overrides,
  });
}
const history = VaultAccountingHistorySchema.parse({
  vault: "0xabc",
  chainId: 143,
  from: "2026-10-01",
  to: "2026-10-11",
  status: "available",
  latest: null,
  daily: [],
  composition: {
    at: "2026-10-11T12:00:00.000Z",
    basis: "gross_assets",
    idleUsdcUsd: 10,
    idleAusdUsd: 5,
    monHoldingsUsd: 60,
    shortEquityBookedUsd: 30,
    accruedFeesUsd: 5,
    shortBookedAt: "2026-10-11T12:00:00.000Z",
    shortBookFresh: true,
  },
  perpl: {
    accountId: 1,
    marketId: 10,
    historyFrom: null,
    historyComplete: true,
    syncedThrough: null,
  },
  sources: {
    vaultReturn: "contract_book_value",
    fundingSettled: "perpl_account_and_position_events",
    fundingObserved: "perpl_settled_plus_open_accrual",
    tradingFees: "perpl_fills",
    staking: "estimated_from_recorded_balance_and_assumed_apy",
    strategyReturn: "strategy_income_over_vault_value",
  },
});

describe("financial chart readings", () => {
  it("does not display historical readings belonging to another vault, chain, or example", () => {
    expect(historyMatchesVault(history, { vault: "0xABC", chainId: 143, source: "onchain" })).toBe(
      true,
    );
    expect(historyMatchesVault(history, { vault: "0xdef", chainId: 143, source: "onchain" })).toBe(
      false,
    );
    expect(
      historyMatchesVault(history, { vault: "0xabc", chainId: 10143, source: "onchain" }),
    ).toBe(false);
    expect(historyMatchesVault(history, { vault: "0xabc", chainId: 143, source: "demo" })).toBe(
      false,
    );
  });

  it("keeps observed earnings separate from settled payments, including funding paid", () => {
    const d = day("2026-10-11", {
      fundingObservedUsd: -2,
      fundingSettledUsd: 10,
      stakingEstimatedUsd: 1,
    });
    expect(fundingValue(d, "observed")).toBe(-2);
    expect(fundingValue(d, "settled")).toBe(10);
    expect(incomeValue(d, "observed")).toBe(-1);
    expect(incomeValue(d, "settled")).toBe(11);
  });

  it("never treats a missing source as zero income", () => {
    const d = day("2026-10-11", { stakingEstimatedUsd: 1, fundingSettledUsd: 0 });
    expect(incomeValue(d, "observed")).toBeNull();
    expect(incomeValue(d, "settled")).toBe(1);
    expect(incomeValue(day("2026-10-11", { fundingObservedUsd: 0 }), "observed")).toBeNull();
  });

  it("accumulates only earned funding and estimated staking, independent of share price or settlements", () => {
    const days = [
      day("2026-10-01", {
        fundingObservedUsd: 2,
        stakingEstimatedUsd: 1,
        fundingSettledUsd: 20,
        fundingObservedSeconds: 86400,
        stakingCoveredSeconds: 86400,
      }),
      day("2026-10-02", {
        fundingObservedUsd: -5,
        stakingEstimatedUsd: 1,
        fundingSettledUsd: 0,
        fundingObservedSeconds: 86400,
        stakingCoveredSeconds: 86400,
        pricePerShareUsd: 4,
        vaultReturnPct: 300,
        shortBookFresh: false,
      }),
    ];
    expect(cumulativeIncome(days).map((point) => point?.value)).toEqual([3, -1]);
    expect(cumulativeIncome(days)[1]).toMatchObject({ funding: -3, staking: 2, partial: false });
    expect(
      cumulativeIncome(days.map((d) => ({ ...d, pricePerShareUsd: 100, vaultReturnPct: 9999 }))),
    ).toEqual(cumulativeIncome(days));
  });

  it("preserves gaps and partial coverage without counting unpaired funding or inventing zero income", () => {
    const points = cumulativeIncome([
      day("2026-10-01", { fundingObservedUsd: 50 }),
      day("2026-10-02", { fundingObservedUsd: 2, stakingEstimatedUsd: 1 }),
      day("2026-10-03", { stakingEstimatedUsd: 20 }),
      day("2026-10-04", { fundingObservedUsd: 0, stakingEstimatedUsd: 0 }),
    ]);
    expect(points.map((point) => point?.value ?? null)).toEqual([null, 3, null, 3]);
    expect(points[3]).toMatchObject({ funding: 2, staking: 1, partial: true });
    expect(incomeRuns(points).map((run) => run.map((point) => point.index))).toEqual([[1], [3]]);
    expect(cumulativeIncome([day("2026-10-01")])).toEqual([null]);
  });

  it("breaks return lines at unknown days, stale reports, and empty-vault restarts", () => {
    const runs = returnRuns([
      day("2026-10-01"),
      day("2026-10-02", { vaultReturnPct: 1 }),
      day("2026-10-03", { vaultReturnPct: null }),
      day("2026-10-04", { vaultReturnPct: 2 }),
      day("2026-10-05", { vaultReturnPct: 3, shortBookFresh: false }),
      day("2026-10-06", { vaultReturnPct: 4 }),
      day("2026-10-07", { vaultReturnPct: 0, returnSegment: 1 }),
    ]);
    expect(runs.map((run) => run.map((point) => point.index))).toEqual([[0, 1], [3], [5], [6]]);
    expect(
      recordedReturn(day("2026-10-11", { pricePerShareUsd: null, vaultReturnPct: 10 })),
    ).toBeNull();
  });

  it("uses gross holdings and booked equity, combining idle USDC and AUSD; fees remain a liability", () => {
    const composition = compositionSlices(history)!;
    expect(composition.total).toBe(105);
    expect(composition.slices.map((slice) => slice.value)).toEqual([60, 30, 15]);
    expect(composition.slices[2]).toEqual({ id: "usd", label: "USD", value: 15 });
    expect(composition.chartable).toBe(true);
    expect(composition.slices.some((slice) => /fee|notional/i.test(slice.label))).toBe(false);
  });

  it("does not convert a negative account value into a positive pie slice", () => {
    expect(
      compositionSlices({
        ...history,
        composition: { ...history.composition!, shortEquityBookedUsd: -30 },
      })?.chartable,
    ).toBe(false);
    expect(compositionSlices({ ...history, composition: null })).toBeNull();
  });

  it("retains small live-vault amounts and negative signs in the readout", () => {
    expect(historyUsd(0.00007, true)).toBe("+$0.000070");
    expect(historyUsd(-0.001042, true)).toBe("−$0.001042");
    expect(historyUsd(0)).toBe("$0.00");
    expect(historyUsd(null)).toBe("—");
    expect(historyPercent(-0.004)).toBe("−0.0040%");
  });
});

describe("strategy return over deposited capital", () => {
  const earning = (date: string, funding: number | null, staking: number | null) =>
    day(date, {
      fundingObservedUsd: funding,
      fundingObservedSeconds: funding === null ? 0 : 86_400,
      stakingEstimatedUsd: staking,
      stakingCoveredSeconds: staking === null ? 0 : 86_400,
    });

  it("reports income to date as a percentage of the vault's value", () => {
    const points = strategyReturn([earning("2026-10-01", 0.3, 0.2), earning("2026-10-02", 0.3, 0.2)], 50);
    // $0.50 then $1.00 of income on a $50 vault.
    expect(points[0]?.value).toBeCloseTo(1, 10);
    expect(points[1]?.value).toBeCloseTo(2, 10);
    expect(points[1]?.incomeUsd).toBeCloseTo(1, 10);
    expect(points.every((point) => point?.partial === false)).toBe(true);
  });

  it("counts a component that is recorded even when the other is unavailable", () => {
    const points = strategyReturn([earning("2026-10-01", 0.5, null)], 50);
    expect(points[0]?.value).toBeCloseTo(1, 10);
    expect(points[0]?.partial).toBe(true);
  });

  it("holds the running total through a day with no recorded income at all", () => {
    const points = strategyReturn(
      [earning("2026-10-01", 0.5, null), earning("2026-10-02", null, null)],
      50,
    );
    expect(points[1]?.value).toBeCloseTo(1, 10);
    expect(points[1]?.partial).toBe(true);
    expect(strategyRuns(points)).toHaveLength(1);
  });

  it("reads as unavailable until vault value is known, never dividing by zero", () => {
    for (const capital of [null, 0]) {
      expect(strategyReturn([earning("2026-10-01", 0.5, 0.5)], capital)).toEqual([null]);
    }
  });

  it("leaves a gap before the first recorded income rather than drawing from zero", () => {
    const points = strategyReturn(
      [earning("2026-10-01", null, null), earning("2026-10-02", 0.5, 0.5)],
      50,
    );
    expect(points[0]).toBeNull();
    expect(points[1]?.value).toBeCloseTo(2, 10);
  });

  it("still reports a negative total rather than flooring a real funding loss at zero", () => {
    const points = strategyReturn([earning("2026-10-01", -0.5, 0)], 50);
    expect(points[0]?.value).toBeCloseTo(-1, 10);
  });

  it("follows the settled funding view when the panel switches to it", () => {
    const settled = day("2026-10-01", {
      fundingObservedUsd: 1,
      fundingObservedSeconds: 86_400,
      fundingSettledUsd: 0.25,
      stakingEstimatedUsd: 0,
      stakingCoveredSeconds: 86_400,
    });
    expect(strategyReturn([settled], 50, "settled")[0]?.value).toBeCloseTo(0.5, 10);
  });

  it("takes its denominator from a reading the collector already records", () => {
    // netAssetsUsd is one totalAssets() call in every snapshot: no deposit history is needed.
    expect(history.sources.strategyReturn).toBe("strategy_income_over_vault_value");
  });
});

describe("framing the recorded range", () => {
  const blank = (date: string) => day(date, { pricePerShareUsd: null, snapshotAt: null });
  const recorded = (date: string) =>
    day(date, { snapshotAt: `${date}T12:00:00.000Z`, fundingObservedUsd: 0.01 });

  it("starts the axis at the first day with a reading", () => {
    const days = [blank("2026-09-14"), blank("2026-09-15"), recorded("2026-10-11")];
    expect(trimToRecorded(days).map((d) => d.date)).toEqual(["2026-10-11"]);
  });

  it("keeps trailing days with no reading, because the gap to today is information", () => {
    const days = [blank("2026-10-10"), recorded("2026-10-11"), blank("2026-10-12")];
    expect(trimToRecorded(days).map((d) => d.date)).toEqual(["2026-10-11", "2026-10-12"]);
  });

  it("does not let a backfilled settlement anchor the axis to days with nothing to plot", () => {
    const settled = day("2026-09-30", {
      pricePerShareUsd: null,
      snapshotAt: null,
      fundingSettledUsd: 0.0177,
    });
    expect(hasReading(settled)).toBe(false);
    const days = [blank("2026-09-29"), settled, recorded("2026-10-11")];
    expect(trimToRecorded(days).map((d) => d.date)).toEqual(["2026-10-11"]);
  });

  it("reports the settled funding and fees the axis leaves out, rather than losing them", () => {
    const days = [
      day("2026-09-28", { pricePerShareUsd: null, snapshotAt: null, tradingFeesUsd: 0.0035 }),
      day("2026-09-30", { pricePerShareUsd: null, snapshotAt: null, fundingSettledUsd: 0.0177 }),
      recorded("2026-10-11"),
    ];
    expect(settledBefore(days)).toEqual({ funding: 0.0177, fees: 0.0035 });
  });

  it("says nothing about earlier days when they held no settlements or fees", () => {
    expect(settledBefore([blank("2026-10-10"), recorded("2026-10-11")])).toBeNull();
    // Nothing is trimmed at all, so there is nothing to report either.
    expect(settledBefore([recorded("2026-10-11"), blank("2026-10-12")])).toBeNull();
  });

  it("does not treat a scanned-but-empty day as a reading", () => {
    const scanned = day("2026-09-20", {
      pricePerShareUsd: null,
      snapshotAt: null,
      fundingSettledUsd: 0,
      tradingFeesUsd: 0,
    });
    expect(hasReading(scanned)).toBe(false);
  });

  it("leaves a series that has no readings at all untouched", () => {
    const days = [blank("2026-10-10"), blank("2026-10-11")];
    expect(trimToRecorded(days)).toEqual(days);
  });
});
