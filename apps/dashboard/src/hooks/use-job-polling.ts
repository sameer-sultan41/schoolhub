"use client";

import { useCallback, useEffect, useState } from "react";
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
  /** The failed poll's error while `isError` is true, else `null`. */
  error: unknown;
  /** Starts a fresh watch of the same job — an immediate poll and a new timeout
   * budget. For a caller whose watch timed out or hit a poll error while the job
   * itself may well still be running: resuming observes that job, where re-triggering
   * would orphan it. A no-op while `jobId` is null. */
  resume: () => void;
}

/**
 * Polls `GET /jobs/{id}` (via `Services.jobs.fetchJob`) at `POLL_INTERVAL_MS` until the
 * job reaches `succeeded`/`failed`, the poll request itself errors, or
 * `MAX_POLL_DURATION_MS` elapses first. `module` namespaces the query key (e.g.
 * `"staff"`) so two features polling different jobs never collide on one cache entry.
 *
 * Every watch — a new `jobId`, the same `jobId` again after being `null` (a dialog
 * reopened), or `resume()` — gets its own number, and with it its own query-cache entry
 * and timeout budget, so it never inherits a previous watch's cached timeout or poll
 * error.
 *
 * The timeout is a `setTimeout` whose callback calls `setTimedOutWatch` — not a
 * `Date.now()` comparison read during render. An unchanging "still running" poll
 * response leaves `data` referentially the same, so nothing would re-render on its own
 * once polling stopped producing new data; the state update is what reaches the UI.
 */
export function useJobPolling(module: string, jobId: string | null): JobPollingResult {
  const [watch, setWatch] = useState(0);
  // React's "store the previous value in state" pattern — resets per `jobId` change
  // during render, not in an effect, so no render ever sees the old watch's state.
  const [watchedJobId, setWatchedJobId] = useState(jobId);
  if (jobId !== watchedJobId) {
    setWatchedJobId(jobId);
    setWatch((current) => current + 1);
  }
  const [timedOutWatch, setTimedOutWatch] = useState<number | null>(null);

  // The RAW timer firing — used only to stop the query (`skipToken` below). Reported
  // `isTimedOut` is narrower (see below).
  const rawTimedOut = jobId !== null && timedOutWatch === watch;

  const query = useQuery({
    queryKey: queryKeys.jobWatch(module, jobId ?? "none", watch),
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
  // Nothing left for the timeout to guard once the job finished or the poll failed.
  const isSettled = isTerminal || query.isError;

  useEffect(() => {
    if (jobId === null || isSettled) return undefined;
    const timer = setTimeout(() => {
      setTimedOutWatch(watch);
    }, MAX_POLL_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [jobId, watch, isSettled]);

  const resume = useCallback(() => {
    setWatch((current) => current + 1);
  }, []);

  // Gated anyway: the timer and a final terminal poll can land in the same tick, and a
  // job that finished must never read as "still running".
  const isTimedOut = rawTimedOut && !isSettled;

  return {
    job,
    isPolling: jobId !== null && !isSettled && !isTimedOut,
    isTimedOut,
    isError: query.isError,
    error: query.isError ? query.error : null,
    resume,
  };
}
