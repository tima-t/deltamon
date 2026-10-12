"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchVaultHistory } from "@/lib/api";

export function useVaultHistory(days: number) {
  return useQuery({
    queryKey: ["vault-history", days],
    queryFn: ({ signal }) => fetchVaultHistory(days, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
