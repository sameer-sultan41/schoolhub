import { collectPages } from "@schoolhub/api-client";
import { useQuery } from "@tanstack/react-query";
import type { DesignationRecord } from "@/features/staff/staff-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

/** Designations change rarely, so this caches far longer than the default —
 * both staleTime and gcTime are set explicitly together, mirroring
 * students/use-reference-data.ts's identical pairing. */
const REFERENCE_DATA_STALE_TIME_MS = 10 * 60_000;
const REFERENCE_DATA_GC_TIME_MS = 15 * 60_000;

export function useDesignations() {
  return useQuery({
    queryKey: queryKeys.list("staff", "designations"),
    queryFn: () => collectPages<DesignationRecord>(apiClient, "/designations"),
    staleTime: REFERENCE_DATA_STALE_TIME_MS,
    gcTime: REFERENCE_DATA_GC_TIME_MS,
  });
}
