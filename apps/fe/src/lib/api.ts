import { VaultStatsSchema, type VaultStats } from "@deltamon/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Local stand-in while the backend is offline. Mirrors the backend's demo payload. */
export function fallbackVaultStats(): VaultStats {
  const now = new Date();
  return {
    source: "demo",
    chainId: 10143,
    vault: null,
    asset: "USDC",
    assetDecimals: 6,
    tvlUsd: 2_418_300,
    totalAssets: "2418300000000",
    totalSupply: "2301400000000",
    pricePerShare: 1.0508,
    depositCapUsd: 5_000_000,
    paused: false,
    apy: { net: 15.2, staking: 9.1, funding: 6.8, lending: 0, costs: -0.7, source: "estimate" },
    netDeltaBps: 40,
    hedgeRatioBps: 9_960,
    legs: {
      long: { venue: "aPriori", asset: "aprMON", valueUsd: 1_204_300 },
      short: { venue: "Perpl", asset: "MON-PERP", valueUsd: 1_199_500 },
    },
    lastRebalanceAt: new Date(now.getTime() - 12 * 60_000).toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function fetchVaultStats(): Promise<VaultStats> {
  const res = await fetch(`${API_URL}/api/vault`, { signal: AbortSignal.timeout(4_000) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return VaultStatsSchema.parse(await res.json());
}
