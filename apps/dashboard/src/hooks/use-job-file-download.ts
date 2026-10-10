"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useJobPolling } from "@/hooks/use-job-polling";
import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";
import { Services } from "@/services";
import type { ExportJobResult } from "@/services/modules/jobs/jobs-service";

export interface JobFileDownloadMessages {
  startFailed: string;
  downloadFailed: string;
  timedOut: string;
  failed: string;
  /** Receives the succeeded job's `result` (e.g. ID cards' `{count}`). */
  success: (result: Record<string, unknown> | null) => string;
}

export interface UseJobFileDownloadOptions<TArgs> {
  /** Namespaces the polling query key (see `useJobPolling`). */
  module: string;
  start: (args: TArgs) => Promise<{ jobId: string }>;
  filename: string;
  messages: JobFileDownloadMessages;
}

export interface JobFileDownload<TArgs> {
  /** Starts a job — or, while one is stalled (timed out / poll error), resumes watching it. */
  run: (args: TArgs) => void;
  isBusy: boolean;
  isStalled: boolean;
  progress: number;
}

/**
 * Triggers a `202 + job` endpoint whose result is a file, watches the job, and downloads
 * the file once it succeeds — the shared flow behind every export button (`/staff`,
 * `/students`) and students' ID-card PDF.
 */
export function useJobFileDownload<TArgs = void>({
  module,
  start,
  filename,
  messages,
}: UseJobFileDownloadOptions<TArgs>): JobFileDownload<TArgs> {
  const tErrors = useTranslations("errors");
  const [jobId, setJobId] = useState<string | null>(null);
  // The job whose terminal outcome (download or failure toast) was already handled, so a
  // re-render — even one that changes `messages` — can never act on it twice.
  const handledJobIdRef = useRef<string | null>(null);

  const trigger = useMutation({
    // Not `mutationFn: start` — TanStack passes a second (context) argument, which would
    // reach a `start` that happens to take an optional second parameter.
    mutationFn: (args: TArgs) => start(args),
    onSuccess: (accepted) => {
      setJobId(accepted.jobId);
    },
    onError: (error: unknown) => {
      toast.error(resolveErrorMessage(error, tErrors, messages.startFailed));
    },
  });

  const { job, isTimedOut, isError, resume } = useJobPolling(module, jobId, {
    onTimedOut: () => {
      toast.error(messages.timedOut);
    },
    onError: () => {
      toast.error(messages.failed);
    },
  });
  // True until the job reaches a real terminal state — broader than polling, which also
  // stops on a timeout or failed poll while the job may still be running server-side.
  const hasActiveJob = jobId !== null && job?.status !== "succeeded" && job?.status !== "failed";
  // Unfinished but no longer watched: `run` resumes this job, since a fresh trigger would
  // overwrite `jobId` and orphan it.
  const isStalled = hasActiveJob && (isTimedOut || isError);

  // A mutation, not a bare promise in the effect, so `isDownloadPending` keeps the caller
  // busy through the "job succeeded, URL not fetched yet" gap — otherwise a double-click
  // there would start a second export.
  const { mutate: download, isPending: isDownloadPending } = useMutation({
    mutationFn: async (result: Record<string, unknown> | null) => ({
      url: await Services.jobs.fetchFileDownloadUrl(
        (result as ExportJobResult | null)?.result_file_id ?? "",
      ),
      result,
    }),
    onSuccess: ({ url, result }) => {
      downloadFile(url, filename);
      toast.success(messages.success(result));
    },
    onError: (error: unknown) => {
      toast.error(resolveErrorMessage(error, tErrors, messages.downloadFailed));
    },
  });

  useEffect(() => {
    if (!job || handledJobIdRef.current === job.id) return;
    if (job.status === "succeeded" && (job.result as ExportJobResult | null)?.result_file_id) {
      handledJobIdRef.current = job.id;
      download(job.result);
    } else if (job.status === "failed") {
      handledJobIdRef.current = job.id;
      toast.error(job.error ?? messages.failed);
    }
  }, [job, download, messages.failed]);

  return {
    run: (args: TArgs) => {
      if (isStalled) resume();
      else trigger.mutate(args);
    },
    isBusy: trigger.isPending || isDownloadPending || (hasActiveJob && !isStalled),
    isStalled,
    progress: job?.progress ?? 0,
  };
}
