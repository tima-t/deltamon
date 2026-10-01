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

/** Below a dollar the pipeline is not worth seven transactions, whatever the config says. */
export const MIN_DEPLOY_USDC = 1_000_000n;

/**
 * The configured threshold in the asset's own units. USDC carries six decimals, and the floor
 * applies even at a threshold of zero: a run that allocates dust costs more in gas than it moves.
 */
export function thresholdUnits(minIdleUsdc: number): bigint {
  const configured = BigInt(Math.round(minIdleUsdc * 1e6));
  return configured > MIN_DEPLOY_USDC ? configured : MIN_DEPLOY_USDC;
}
