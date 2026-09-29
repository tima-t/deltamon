import type { FlowPeriod } from "@deltamon/shared";

/**
 * Which window a periodic trigger belongs to.
 *
 * The pipeline keys each run on this, and the database rejects a duplicate key, so a restart in
 * the middle of a window resumes rather than starting a second run for the same period.
 */
export function windowKey(period: Exclude<FlowPeriod, "deposit">, now = Date.now()): string {
  const hours = period === "12h" ? 12 : 24;
  const size = hours * 3_600_000;
  return `period:${period}:${Math.floor(now / size)}`;
}

/** Below a dollar the pipeline is not worth four transactions. */
export const MIN_DEPLOY_USDC = 1_000_000n;
