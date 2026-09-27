"use client";

import { useEffect, useState } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";

const POLL_INTERVAL_MS = 2000;
/** ~2 minutes — long enough for a real CSV export/import, short enough that a stuck
 * worker doesn't leave the UI spinning forever. */
const MAX_POLL_DURATION_MS = 120_000;

export interface JobPollingResult {
  job: BackgroundJobRecord | undefined;
  /** True while an actual poll is scheduled — false once terminal, timed out,
   * errored, or `jobId` is null. */
  isPolling: boolean;
  isTimedOut: boolean;
  /** True once the poll request itself has failed — distinct from the job itself
   * reaching `status: "failed"`, which is a normal terminal state the request
   * succeeded in reporting. */
  isError: boolean;
}

/**
 * Polls `GET /jobs/{id}` (via `Services.jobs.fetchJob`) at `POLL_INTERVAL_MS` until the
 * job reaches `succeeded`/`failed`, the poll request itself errors, or
 * `MAX_POLL_DURATION_MS` elapses first. `module` namespaces the query key (e.g.
 * `"staff"`) so two features polling different jobs never collide on one cache entry.
 *
 * The timeout is a `setTimeout` whose callback calls `setTimedOutJobId` — not a
 * `Date.now()` comparison read during render. `useQuery` only re-renders this
 * component when a value it actually reads changes, and an unchanging "still running"
 * poll response leaves `data` referentially the same — nothing would ever re-render on
 * its own once polling stopped producing new data, so a render-time clock check could
 * compute the right answer and still never reach the UI. The state update below is
 * what actually schedules a re-render; resetting per `jobId` (the effect's own
 * dependency) is what gives a fresh job its own full budget rather than inheriting a
 * previous job's already-expired one.
 */
export function useJobPolling(module: string, jobId: string | null): JobPollingResult {
  const [timedOutJobId, setTimedOutJobId] = useState<string | null>(null);

  useEffect(() => {
    if (jobId === null) return undefined;
    const timer = setTimeout(() => {
      setTimedOutJobId(jobId);
    }, MAX_POLL_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [jobId]);

  // The RAW timer firing — used only to stop the query (`skipToken` below). Reported
  // `isTimedOut` (the return value) is narrower: the timer has no idea whether the job
  // already finished, so without gating on `isTerminal`/`isError` below, a job that
  // succeeded in, say, 5 seconds would still flip this to `true` 120 seconds later
  // (the timer set on mount keeps running regardless), producing a false "still
  // running" toast on a completely finished, successful job.
  const rawTimedOut = jobId !== null && jobId === timedOutJobId;

  const query = useQuery({
    queryKey: queryKeys.detail(module, "jobs", jobId ?? "none"),
    queryFn: jobId !== null && !rawTimedOut ? () => Services.jobs.fetchJob(jobId) : skipToken,
    // Polling a background job the user is actively waiting on is exactly the case
    // this option exists for — without it, TanStack Query pauses polling the moment
    // the tab loses focus, and a user who switches tabs mid-export would come back to
    // a false timeout instead of their finished file.
    refetchIntervalInBackground: true,
    refetchInterval: (latest) => {
      const status = latest.state.data?.status;
      if (status === "succeeded" || status === "failed") return false;
      if (latest.state.status === "error") return false;
      return POLL_INTERVAL_MS;
    },
  });

  const job = query.data;
  const isTerminal = job?.status === "succeeded" || job?.status === "failed";
  const isTimedOut = rawTimedOut && !isTerminal && !query.isError;

  return {
    job,
    isPolling: jobId !== null && !isTerminal && !isTimedOut && !query.isError,
    isTimedOut,
    isError: query.isError,
  };
}
