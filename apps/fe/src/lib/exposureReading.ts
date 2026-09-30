import type { VaultStats } from "@deltamon/shared";

export function exposureReading(stats: Pick<VaultStats, "source" | "hedge">, now: number) {
  const { hedge } = stats;
  const illustrative = stats.source === "demo";
  const ageMs = hedge.reportAsOf ? now - new Date(hedge.reportAsOf).getTime() : Infinity;
  const invalidReportTime = hedge.reportAsOf !== null && !Number.isFinite(ageMs);
  const futureReport = ageMs < -30_000;
  const currentReport = ageMs >= -30_000 && ageMs <= 300_000;
  const shortKnown = hedge.shortExposureUsd !== null;
  const measured =
    !illustrative &&
    hedge.dataStatus === "fresh" &&
    shortKnown &&
    hedge.netDeltaBps !== null &&
    currentReport;
  const shownDelta = (illustrative && shortKnown) || measured ? hedge.netDeltaBps : null;
  const withinTarget = measured && Math.abs(hedge.netDeltaBps!) <= 200;
  const shortDrawable = shortKnown && (illustrative || measured);
  const status = illustrative
    ? "Illustrative example"
    : invalidReportTime || futureReport
      ? "Manager report time invalid"
      : hedge.dataStatus === "stale" || (hedge.dataStatus === "fresh" && !currentReport)
        ? "Manager report stale"
        : !measured
          ? "Short report unavailable"
          : withinTarget
            ? "Within ±2% target"
            : "Outside ±2% target";
  const tone = illustrative || !measured ? "muted" : withinTarget ? "good" : "warn";

  return {
    illustrative,
    measured,
    shownDelta,
    withinTarget,
    shortKnown,
    shortDrawable,
    invalidReportTime,
    futureReport,
    status,
    tone,
  };
}
