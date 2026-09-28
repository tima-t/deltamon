import { env } from "../config.js";
import { getPerplContext } from "./perpl.js";
import { PerplSession, tradingSocketUrl } from "./perplSession.js";
import type { MarketConfig } from "./perplOrders.js";

/**
 * The one Perpl account this backend trades, and the single socket that holds it.
 *
 * Every address in PERPL_MANAGERS shares it: they authenticate as themselves, but they all act on
 * the account behind PERPL_API_KEY. Orders are logged with the address that sent them, since the
 * exchange itself cannot tell them apart.
 */

let shared: PerplSession | null = null;

export function credentialsConfigured(): boolean {
  return Boolean(env.PERPL_API_KEY && env.PERPL_API_KEY_SECRET);
}

/** The live socket, opened on first use. Null while no credentials are configured. */
export function sharedSession(): PerplSession | null {
  if (!credentialsConfigured()) return null;
  if (!shared) {
    shared = new PerplSession(
      { apiKey: env.PERPL_API_KEY!, secret: env.PERPL_API_KEY_SECRET! },
      env.PERPL_CHAIN_ID,
      tradingSocketUrl(env.PERPL_API_URL),
      "shared",
    );
    shared.start();
  }
  return shared;
}

export function stopAllSessions(): void {
  shared?.stop();
  shared = null;
}

let marketCache: { at: number; markets: MarketConfig[] } | null = null;

/**
 * Markets as Perpl currently lists them. Decimals are config, so they are read, never assumed, and
 * the cache is short because the mark price here feeds a liquidation buffer.
 */
export async function listMarkets(maxAgeMs = 10_000): Promise<MarketConfig[]> {
  if (marketCache && Date.now() - marketCache.at < maxAgeMs) return marketCache.markets;
  const context = await getPerplContext();
  const markets: MarketConfig[] = [];
  for (const raw of context.markets ?? []) {
    const m = raw as Record<string, unknown>;
    const config = (m.config ?? {}) as Record<string, unknown>;
    const id = typeof m.id === "number" ? m.id : null;
    const name = typeof m.name === "string" ? m.name : null;
    if (id === null || name === null) continue;
    const state = (m.state ?? {}) as Record<string, unknown>;
    const funding = (m.funding ?? {}) as Record<string, unknown>;
    const numberOr = (v: unknown): number | null => (typeof v === "number" ? v : null);
    markets.push({
      id,
      name,
      priceDecimals: typeof config.price_decimals === "number" ? config.price_decimals : 0,
      sizeDecimals: typeof config.size_decimals === "number" ? config.size_decimals : 0,
      orderTtlBlocks: typeof m.order_ttl_blocks === "number" ? m.order_ttl_blocks : 20,
      isOpen: config.is_open !== false,
      markPrice: numberOr(state.mrk),
      fundingRate: numberOr(funding.rate),
      fundingIntervalSec: numberOr(m.funding_interval_sec),
      fundingSum: numberOr(funding.sum),
      fundingSumScalingExp:
        typeof config.funding_sum_scaling_exp === "number" ? config.funding_sum_scaling_exp : 0,
      fundingLastAtMs: numberOr((funding.at as Record<string, unknown> | undefined)?.t),
      maintenanceMargin: numberOr(config.maintenance_margin),
      initialMargin: numberOr(config.initial_margin),
    });
  }
  marketCache = { at: Date.now(), markets };
  return markets;
}

export async function findMarket(name: string): Promise<MarketConfig | null> {
  const wanted = name.trim().toUpperCase();
  return (await listMarkets()).find((m) => m.name.toUpperCase() === wanted) ?? null;
}
