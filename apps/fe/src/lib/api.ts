import {
  VaultStatsSchema,
  VaultAccountingHistorySchema,
  type VaultStats,
  type VaultAccountingHistory,
} from "@deltamon/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function fetchVaultStats(): Promise<VaultStats> {
  const res = await fetch(`${API_URL}/api/vault`, { signal: AbortSignal.timeout(4_000) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return VaultStatsSchema.parse(await res.json());
}

export async function fetchVaultHistory(
  days: number,
  signal?: AbortSignal,
): Promise<VaultAccountingHistory> {
  const timeout = AbortSignal.timeout(10_000);
  const res = await fetch(`${API_URL}/api/vault/history?days=${days}`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`History API ${res.status}`);
  return VaultAccountingHistorySchema.parse(await res.json());
}
