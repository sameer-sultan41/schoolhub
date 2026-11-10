"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { useJobPolling } from "@/hooks/use-job-polling";
import { ApiError } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";

export interface ExamJobOptions<TAccepted extends { jobId: string }> {
  /** Namespaces the poll (`useJobPolling`). */
  jobModule: string;
  /** Starts the job with this intent's `Idempotency-Key`; resolves to the accepted job (its id,
   * and anything else the `202` carries, such as the admit cards' counts). */
  start: (idempotencyKey: string) => Promise<TAccepted>;
  /** The server accepted the job: the `202`'s own content. */
  onAccepted?: (accepted: TAccepted) => void;
  /** After the server accepts, and again once the job ends: reload what it changes. */
  onSettled: () => void;
  /** The job ended, succeeded or failed, once per job. */
  onEnded: (job: BackgroundJobRecord) => void;
  /** The server refused to start it. */
  onStartError?: (error: unknown) => void;
  onTimedOut: () => void;
}

/**
 * A colon-action answering `202` + a job (issue admit cards, process results, generate report
 * cards): starts it, polls it to its end and reports that end once. One `Idempotency-Key` stands
 * for one intent: kept until the request is accepted, so a retry after a lost response replays
 * the first answer, and dropped once it is, so pressing the button again later is a new run.
 */
export function useExamJob<TAccepted extends { jobId: string }>({
  jobModule,
  start,
  onAccepted,
  onSettled,
  onEnded,
  onStartError,
  onTimedOut,
}: ExamJobOptions<TAccepted>) {
  const keyRef = useRef<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // The job whose end was already acted on, so a re-render never reloads or reports twice.
  const handledJobRef = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      keyRef.current ??= crypto.randomUUID();
      return start(keyRef.current);
    },
    onSuccess: (accepted) => {
      keyRef.current = null;
      setJobId(accepted.jobId);
      onAccepted?.(accepted);
      onSettled();
    },
    onError: (error: unknown) => {
      onStartError?.(error);
    },
  });

  const { job, isTimedOut, isError, error, resume } = useJobPolling(jobModule, jobId, {
    onTimedOut,
  });
  // The server refused the poll outright (not a blip that outlasted the retries): nothing to watch.
  const isPollRefused = isError && !(error instanceof ApiError && error.isTransient);
  const hasEnded = job?.status === "succeeded" || job?.status === "failed";
  const isWatching = jobId !== null && !hasEnded && !isPollRefused;
  const isStalled = isWatching && (isTimedOut || isError);

  useEffect(() => {
    if (!job || handledJobRef.current === job.id || !hasEnded) return;
    handledJobRef.current = job.id;
    onSettled();
    onEnded(job);
  }, [job, hasEnded, onSettled, onEnded]);

  return {
    run: () => {
      mutation.mutate();
    },
    resume,
    isBusy: mutation.isPending || (isWatching && !isStalled),
    isRunning: isWatching && !isStalled,
    isStalled,
    progress: job?.progress ?? 0,
  };
}
