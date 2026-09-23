"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchVaultStats } from "@/lib/api";

export function useVaultStats() {
  const query = useQuery({
    queryKey: ["vault-stats"],
    queryFn: fetchVaultStats,
    refetchInterval: 30_000,
  });

  return {
    stats: query.isError ? null : (query.data ?? null),
    isLive: query.isSuccess && query.data?.source === "onchain",
    isOffline: query.isError,
    isLoading: query.isPending,
  };
}
