import { VaultStatsSchema, type VaultStats } from "@deltamon/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function fetchVaultStats(): Promise<VaultStats> {
  const res = await fetch(`${API_URL}/api/vault`, { signal: AbortSignal.timeout(4_000) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return VaultStatsSchema.parse(await res.json());
}
