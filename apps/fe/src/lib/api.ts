import { VaultStatsSchema, type VaultStats } from "@deltamon/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Local stand-in while the backend is offline. Mirrors the backend's demo payload. */
export function fallbackVaultStats(): VaultStats {
  const now = new Date();
  const monPrice = 0.02643;
  const usdc = 51_380;
  const mon = 2_915_530;
  const monValue = mon * monPrice;
  const tvl = usdc + monValue;
  const supply = 126_800;
  const monShareBps = Math.round((monValue / tvl) * 10_000);
  return {
    source: "demo",
    chainId: 143,
    vault: null,
    asset: "USDC",
    assetDecimals: 6,
    tvlUsd: tvl,
    totalAssets: String(Math.round(tvl * 1e6)),
    depositCapUsd: 250_000,
    minDepositUsd: 10,
    paused: false,
    shareToken: {
      symbol: "sdMON",
      decimals: 18,
      totalSupply: `${supply}000000000000000000`,
      pricePerShare: tvl / supply,
    },
    allocation: {
      usdc: { balance: String(usdc * 1e6), valueUsd: usdc },
      mon: { balance: `${mon}000000000000000000`, valueUsd: monValue, priceUsd: monPrice },
      monShareBps,
      targetMonBps: 6_000,
      driftBps: monShareBps - 6_000,
      rebalanceThresholdBps: 500,
    },
    lastRebalanceAt: new Date(now.getTime() - 37 * 60_000).toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function fetchVaultStats(): Promise<VaultStats> {
  const res = await fetch(`${API_URL}/api/vault`, { signal: AbortSignal.timeout(4_000) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return VaultStatsSchema.parse(await res.json());
}
