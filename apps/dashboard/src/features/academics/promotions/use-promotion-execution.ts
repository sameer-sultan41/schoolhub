"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useJobPolling } from "@/hooks/use-job-polling";
import { ApiError, Services, type PromotionExecutionReport } from "@/services";
import { PROMOTION_EXECUTE_JOB_MODULE } from "@/services/modules/promotions/promotions-constant";
import { toPromotionExecutionReport } from "@/services/modules/promotions/promotions-helper";
import { usePromotionBatchCache } from "./use-promotion-batch-cache";

export interface PromotionExecution {
  /**
   * Queues the execution (`202`) and starts watching its job. Rejects with the server's refusal,
   * for the caller to show. Called while a request is already in flight, it joins that request
   * rather than sending a second one.
   */
  start: () => Promise<void>;
  /** From the request until the job ends: it is queued or running, watched or not. */
  isRunning: boolean;
  /** Running, but no longer watched (it timed out, or a poll failed): `resume` watches again. */
  isStalled: boolean;
  resume: () => void;
  /** 0 to 100, from the job. */
  progress: number;
  /** The job succeeded; the batch's refetched status is about to say `executed`. */
  hasSucceeded: boolean;
  /** The finished job's per-student report. */
  report: PromotionExecutionReport | null;
  /** The job failed, was refused by the server, or succeeded with a result that isn't a report. */
  hasFailed: boolean;
}

/**
 * Executes a batch: `executeBatch` answers `202` with a job, polled until it ends, whose `result`
 * is the per-student report. The batch only becomes `executed` when the worker finishes, so the
 * batch (detail and list) is refetched when the job does, not when it is queued.
 *
 * Only `:execute` replays an `Idempotency-Key`. One key stands for one intent to execute: it is
 * kept while the request has not been accepted, so a retry after a lost response rejoins the job
 * already queued, and dropped once it is, so a later run (after a failed job) is a new request.
 */
export function usePromotionExecution(batchId: string): PromotionExecution {
  const { refreshBatchAndList, refreshOnConflict } = usePromotionBatchCache(batchId);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isQueueing, setIsQueueing] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // The job whose end was already acted on, so a re-render never reloads for it twice.
  const handledJobRef = useRef<string | null>(null);

  const start = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    keyRef.current ??= crypto.randomUUID();
    const idempotencyKey = keyRef.current;
    // A new run: the last one's outcome is no longer what the page is about.
    setJobId(null);
    setIsQueueing(true);
    const request = refreshOnConflict(() =>
      Services.promotions.executeBatch(batchId, idempotencyKey),
    )
      .then((accepted) => {
        keyRef.current = null;
        setJobId(accepted.job_id);
      })
      .finally(() => {
        inFlightRef.current = null;
        setIsQueueing(false);
      });
    inFlightRef.current = request;
    return request;
  }, [batchId, refreshOnConflict]);

  const { job, isTimedOut, isError, error, resume } = useJobPolling(
    PROMOTION_EXECUTE_JOB_MODULE,
    jobId,
  );
  // The server definitively refused the poll (a 404/403, not a blip that outlasted the retries):
  // there is no job left to watch, and the run has to be treated as one that went wrong.
  const isPollRefused = isError && !(error instanceof ApiError && error.isTransient);
  const hasEnded = job?.status === "succeeded" || job?.status === "failed";
  const isWatching = jobId !== null && !hasEnded && !isPollRefused;
  const succeededJob = job?.status === "succeeded" ? job : undefined;
  const hasSucceeded = succeededJob !== undefined;
  const report = succeededJob ? toPromotionExecutionReport(succeededJob.result) : null;

  useEffect(() => {
    if (!job || handledJobRef.current === job.id) return;
    if (job.status === "succeeded" || job.status === "failed") {
      handledJobRef.current = job.id;
      refreshBatchAndList();
    }
  }, [job, refreshBatchAndList]);

  return {
    start,
    isRunning: isQueueing || isWatching,
    isStalled: isWatching && (isTimedOut || isError),
    resume,
    progress: job?.progress ?? 0,
    hasSucceeded,
    report,
    hasFailed: job?.status === "failed" || (hasSucceeded && report === null) || isPollRefused,
  };
}
