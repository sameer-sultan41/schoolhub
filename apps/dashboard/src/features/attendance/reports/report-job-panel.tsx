"use client";

import { useEffect, useEffectEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, Card, Progress } from "@schoolhub/ui";
import { toast } from "sonner";

import { useJobPolling } from "@/hooks/use-job-polling";
import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";
import { ApiError, Services, type AttendanceMode } from "@/services";
import { ATTENDANCE_REPORTS_QUERY_MODULE } from "@/services/modules/attendance-reports/attendance-reports-constant";
import {
  jobResultFileId,
  jobResultMode,
} from "@/services/modules/attendance-reports/attendance-reports-helper";

export interface ReportJobPanelProps {
  /** The job a too-large inline run answered with. */
  jobId: string;
  /** The downloaded file's name hint. */
  filename: string;
  /** Told the tenant's mode once the finished job reports it. */
  onModeKnown: (mode: AttendanceMode) => void;
  /** Runs the report again: for a job the server no longer answers for. */
  onRestart: () => void;
}

/**
 * A report over the inline ceiling: the server answered `202` and is building it as a CSV. Shows
 * the job's progress, then a button for the file. A failure says so; a timeout or a transient
 * poll error can check again (the job may well still be running); a refused poll (a 404 or 403)
 * has no job left to watch, so it offers to run the report again, as `useJobFileDownload` does.
 */
export function ReportJobPanel({ jobId, filename, onModeKnown, onRestart }: ReportJobPanelProps) {
  const t = useTranslations("attendance");
  const tErrors = useTranslations("errors");
  const { job, isPolling, isTimedOut, isError, error, resume } = useJobPolling(
    ATTENDANCE_REPORTS_QUERY_MODULE,
    jobId,
  );
  const succeeded = job?.status === "succeeded";
  const fileId = succeeded ? jobResultFileId(job.result) : null;
  const mode = succeeded ? jobResultMode(job.result) : null;
  const isPollRefused = isError && !(error instanceof ApiError && error.isTransient);

  const reportMode = useEffectEvent((known: AttendanceMode) => {
    onModeKnown(known);
  });
  useEffect(() => {
    if (mode !== null) reportMode(mode);
  }, [mode]);

  const download = useMutation({
    mutationFn: (id: string) => Services.jobs.fetchFileDownloadUrl(id),
    onSuccess: (url) => {
      downloadFile(url, filename);
    },
    onError: (downloadError: unknown) => {
      toast.error(resolveErrorMessage(downloadError, tErrors, t("reports.queued.downloadFailed")));
    },
  });

  return (
    <Card>
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="font-medium text-foreground">{t("reports.queued.title")}</p>
        <p className="text-sm text-muted-foreground">{t("reports.queued.description")}</p>
        {isPolling && (
          <div className="w-full max-w-md space-y-1.5">
            <Progress value={job?.progress ?? 0} />
            <p className="text-xs text-muted-foreground">
              {t("reports.queued.progress", { progress: job?.progress ?? 0 })}
            </p>
          </div>
        )}
        {fileId !== null && (
          <>
            <p className="text-sm text-foreground" role="status">
              {t("reports.queued.ready")}
            </p>
            <Button
              variant="primary"
              disabled={download.isPending}
              onClick={() => {
                download.mutate(fileId);
              }}
            >
              {download.isPending ? t("reports.queued.downloading") : t("reports.queued.download")}
            </Button>
          </>
        )}
        {job?.status === "failed" && (
          <Alert variant="destructive">
            <AlertDescription>{job.error ?? t("reports.queued.failed")}</AlertDescription>
          </Alert>
        )}
        {isPollRefused ? (
          <>
            <Alert variant="destructive">
              <AlertDescription>
                {resolveErrorMessage(error, tErrors, t("reports.queued.pollFailed"))}
              </AlertDescription>
            </Alert>
            <Button variant="outline" onClick={onRestart}>
              {t("reports.queued.runAgain")}
            </Button>
          </>
        ) : (
          (isTimedOut || isError) && (
            <>
              <Alert variant={isError ? "destructive" : "warning"}>
                <AlertDescription>
                  {isError ? t("reports.queued.pollFailed") : t("reports.queued.timedOut")}
                </AlertDescription>
              </Alert>
              <Button variant="outline" onClick={resume}>
                {t("reports.queued.checkAgain")}
              </Button>
            </>
          )
        )}
      </div>
    </Card>
  );
}
