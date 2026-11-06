"use client";

import { useEffect, useEffectEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, Card, Progress } from "@schoolhub/ui";
import { toast } from "sonner";

import { useJobPolling } from "@/hooks/use-job-polling";
import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";
import { ApiError, Services } from "@/services";
import { jobResultFileId } from "@/services/shared/report-export";

export interface ReportJobPanelProps {
  /** Namespaces the job's polling query key (the report module's query-key module). */
  module: string;
  /** The job a too-large inline run answered with. */
  jobId: string;
  /** The downloaded file's name hint. */
  filename: string;
  /** Told the finished job's `result`, once: for a module that reads more than the file from it
   * (attendance's `attendance_mode`). */
  onSucceeded?: (result: Record<string, unknown> | null) => void;
  /** Runs the report again: for a job the server no longer answers for. */
  onRestart: () => void;
}

/**
 * A report over the inline ceiling: the server answered `202` and is building it as a CSV. Shows
 * the job's progress, then a button for the file. A failure says so; a timeout or a transient
 * poll error can check again (the job may well still be running); a refused poll (a 404 or 403)
 * has no job left to watch, so it offers to run the report again, as `useJobFileDownload` does.
 * Its copy is the shared `reports` namespace; the attendance and exam reports use it.
 */
export function ReportJobPanel({
  module,
  jobId,
  filename,
  onSucceeded,
  onRestart,
}: ReportJobPanelProps) {
  const t = useTranslations("reports");
  const tErrors = useTranslations("errors");
  const { job, isPolling, isTimedOut, isError, error, resume } = useJobPolling(module, jobId);
  const result = job?.status === "succeeded" ? job.result : undefined;
  const fileId = result === undefined ? null : jobResultFileId(result);
  const isPollRefused = isError && !(error instanceof ApiError && error.isTransient);

  const reportSucceeded = useEffectEvent((finished: Record<string, unknown> | null) => {
    onSucceeded?.(finished);
  });
  useEffect(() => {
    if (result !== undefined) reportSucceeded(result);
  }, [result]);

  const download = useMutation({
    mutationFn: (id: string) => Services.jobs.fetchFileDownloadUrl(id),
    onSuccess: (url) => {
      downloadFile(url, filename);
    },
    onError: (downloadError: unknown) => {
      toast.error(resolveErrorMessage(downloadError, tErrors, t("queued.downloadFailed")));
    },
  });

  return (
    <Card>
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="font-medium text-foreground">{t("queued.title")}</p>
        <p className="text-sm text-muted-foreground">{t("queued.description")}</p>
        {isPolling && (
          <div className="w-full max-w-md space-y-1.5">
            <Progress value={job?.progress ?? 0} />
            <p className="text-xs text-muted-foreground">
              {t("queued.progress", { progress: job?.progress ?? 0 })}
            </p>
          </div>
        )}
        {fileId !== null && (
          <>
            <p className="text-sm text-foreground" role="status">
              {t("queued.ready")}
            </p>
            <Button
              variant="primary"
              disabled={download.isPending}
              onClick={() => {
                download.mutate(fileId);
              }}
            >
              {download.isPending ? t("queued.downloading") : t("queued.download")}
            </Button>
          </>
        )}
        {job?.status === "failed" && (
          <Alert variant="destructive">
            <AlertDescription>{job.error ?? t("queued.failed")}</AlertDescription>
          </Alert>
        )}
        {isPollRefused ? (
          <>
            <Alert variant="destructive">
              <AlertDescription>
                {resolveErrorMessage(error, tErrors, t("queued.pollFailed"))}
              </AlertDescription>
            </Alert>
            <Button variant="outline" onClick={onRestart}>
              {t("queued.runAgain")}
            </Button>
          </>
        ) : (
          (isTimedOut || isError) && (
            <>
              <Alert variant={isError ? "destructive" : "warning"}>
                <AlertDescription>
                  {isError ? t("queued.pollFailed") : t("queued.timedOut")}
                </AlertDescription>
              </Alert>
              <Button variant="outline" onClick={resume}>
                {t("queued.checkAgain")}
              </Button>
            </>
          )
        )}
      </div>
    </Card>
  );
}
