/** Formatting helpers shared by FE and BE responses. Pure functions, no deps. */

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function formatUsd(value: number, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 2 : 0,
  }).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatUnitsToNumber(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}
