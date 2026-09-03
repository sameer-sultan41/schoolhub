import { collectPages } from "@schoolhub/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

/** Campuses/houses change rarely, so these cache far longer than the default —
 * both staleTime and gcTime are set explicitly together (a custom staleTime
 * above the 5-minute default must carry its own gcTime, or the cache entry
 * can be evicted before it goes stale — see app-shell.tsx's tenant query for
 * the same pairing). */
const REFERENCE_DATA_STALE_TIME_MS = 10 * 60_000;
const REFERENCE_DATA_GC_TIME_MS = 15 * 60_000;

interface CampusOption {
  id: string;
  name: string;
  code: string;
}

interface HouseOption {
  id: string;
  name: string;
}

export function useCampuses() {
  return useQuery({
    queryKey: queryKeys.list("school-organization", "campuses"),
    queryFn: () => collectPages<CampusOption>(apiClient, "/campuses"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}

export function useHouses() {
  return useQuery({
    queryKey: queryKeys.list("school-organization", "houses"),
    queryFn: () => collectPages<HouseOption>(apiClient, "/houses"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}
