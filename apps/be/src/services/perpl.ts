import { PERPL_FUNDING_INTERVAL_BLOCKS, type FundingSnapshot } from "@deltamon/shared";
import { z } from "zod";
import { env } from "../config.js";

/**
 * Perpl public context: markets, tokens, chain config.
 * Docs: https://github.com/PerplFoundation/api-docs — the exact market shape is
 * not pinned by a published schema, so fields are read defensively.
 */
const ContextSchema = z.looseObject({
  markets: z.array(z.looseObject({})).optional(),
});
export type PerplContext = z.infer<typeof ContextSchema>;

const HOURS_PER_YEAR = 24 * 365;

export async function getPerplContext(): Promise<PerplContext> {
  const res = await fetch(`${env.PERPL_API_URL}/v1/pub/context`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Perpl context ${res.status}`);
  return ContextSchema.parse(await res.json());
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickNumber(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** Funding snapshots for every market Perpl lists. Hourly funding is annualized linearly. */
export async function getFundingSnapshots(): Promise<FundingSnapshot[]> {
  const ctx = await getPerplContext();
  const now = new Date().toISOString();
  return (ctx.markets ?? []).map((m) => {
    const hourly = pickNumber(m, ["fundingRate", "funding_rate", "funding", "lastFundingRate"]);
    return {
      venue: "Perpl",
      market:
        pickString(m, ["symbol", "name", "ticker", "market"]) ??
        `market-${pickNumber(m, ["id", "market_id"]) ?? "?"}`,
      fundingRateHourly: hourly,
      fundingRateAnnualized: hourly === null ? null : hourly * HOURS_PER_YEAR,
      markPrice: pickNumber(m, ["markPrice", "mark_price", "mark"]),
      updatedAt: now,
    };
  });
}

export const perplFundingIntervalBlocks = PERPL_FUNDING_INTERVAL_BLOCKS;
