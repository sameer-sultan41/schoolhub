"use client";

import { useQuery } from "@tanstack/react-query";
import type { JobRecord } from "@/features/students/job-types";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const POLL_INTERVAL_MS = 1500;
/** Must stay >= POLL_INTERVAL_MS — a shorter gcTime would let the cache entry
 * (and its refetchInterval timer) get garbage-collected between polls the
 * moment nothing is actively rendering it, silently stopping the poll. */
const POLL_GC_TIME_MS = 5000;

const TERMINAL_STATUSES = new Set(["succeeded", "failed"]);

/** Polls `GET /api/v1/jobs/{id}` until the job reaches a terminal state

 * (api-architecture.md §2.7). `staleTime: 0` is deliberate: every tick must
 * be treated as stale so `refetchInterval` actually issues a new request
 * rather than serving a cached one.
 */
export function useJobPolling(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.detail("students", "jobs", jobId ?? ""),
    queryFn: async () => (await apiClient.get<JobRecord>(`/jobs/${jobId}`)).data,
    enabled: Boolean(jobId),
    staleTime: 0,
    gcTime: POLL_GC_TIME_MS,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_STATUSES.has(status) ? false : POLL_INTERVAL_MS;
    },
  });
}
