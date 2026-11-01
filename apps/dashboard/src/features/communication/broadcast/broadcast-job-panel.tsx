"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button, Card, Progress } from "@schoolhub/ui";

import { useJobPolling } from "@/hooks/use-job-polling";
import { BROADCASTS_JOB_MODULE } from "@/services/modules/broadcasts/broadcasts-constant";

export interface BroadcastJobPanelProps {
  /** The job the send answered `202` with. */
  jobId: string;
  /** Starts a new broadcast. */
  onDone: () => void;
}

/** A finished job's count, or null when the result does not carry one. */
function resultCount(result: Record<string, unknown> | null | undefined, key: string) {
  const value = result?.[key];
  return typeof value === "number" ? value : null;
}

/**
 * Step 4: the queued broadcast, watched to its end. A failure says so; a timeout or a failed
 * poll can check again, since the job may well still be running.
 */
export function BroadcastJobPanel({ jobId, onDone }: BroadcastJobPanelProps) {
  const t = useTranslations("communication.broadcast.status");
  const { job, isPolling, isTimedOut, isError, resume } = useJobPolling(
    BROADCASTS_JOB_MODULE,
    jobId,
  );
  const recipients = resultCount(job?.result, "recipient_count");

  return (
    <Card>
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="font-medium text-foreground">{t("title")}</p>
        {isPolling && (
          <div className="w-full max-w-md space-y-1.5">
            <Progress value={job?.progress ?? 0} />
            <p className="text-xs text-muted-foreground">
              {t("progress", { progress: job?.progress ?? 0 })}
            </p>
          </div>
        )}
        {job?.status === "succeeded" && (
          <>
            <p className="text-sm text-foreground" role="status">
              {recipients === null ? t("succeeded") : t("succeededCount", { count: recipients })}
            </p>
            <Button variant="outline" onClick={onDone}>
              {t("another")}
            </Button>
          </>
        )}
        {job?.status === "failed" && (
          <Alert variant="destructive">
            <AlertDescription>{job.error ?? t("failed")}</AlertDescription>
          </Alert>
        )}
        {(isTimedOut || isError) && (
          <>
            <Alert variant={isError ? "destructive" : "warning"}>
              <AlertDescription>{isError ? t("pollFailed") : t("timedOut")}</AlertDescription>
            </Alert>
            <Button variant="outline" onClick={resume}>
              {t("checkAgain")}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
