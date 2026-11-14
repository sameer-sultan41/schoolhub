"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button } from "@schoolhub/ui";
import { Loader2 } from "lucide-react";

import { settlementJobCounts } from "@/services/modules/settlement-imports/settlement-imports-helper";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";

export interface SettlementUploadResultProps {
  /** The finished job, once it ended; `undefined` while it runs or is stalled. */
  job: BackgroundJobRecord | undefined;
  isRunning: boolean;
  isStalled: boolean;
  isPollRefused: boolean;
  progress: number;
  onResume: () => void;
}

/**
 * The reconciliation's progress and end, in the upload dialog's body. The counts are the job's
 * own (`row_count`, `matched`, `exceptions`): never a tally made here. A file with exceptions is
 * a success that points at them (an accountant works them), not an error; a failed job shows the
 * server's own sentence.
 */
export function SettlementUploadResult({
  job,
  isRunning,
  isStalled,
  isPollRefused,
  progress,
  onResume,
}: SettlementUploadResultProps) {
  const t = useTranslations("fees.payments.imports.upload");

  if (job?.status === "failed") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{job.error ?? t("failed")}</AlertDescription>
      </Alert>
    );
  }

  if (job?.status === "succeeded") {
    const { rowCount, matched, exceptions } = settlementJobCounts(job.result);
    return (
      <div role="status" className="space-y-1 text-sm">
        <p className="font-medium text-foreground">{t("matched", { matched, rows: rowCount })}</p>
        <p className="text-muted-foreground">
          {exceptions === 0 ? t("noExceptions") : t("exceptions", { count: exceptions })}
        </p>
      </div>
    );
  }

  if (isStalled || isPollRefused) {
    return (
      <div role="status" className="space-y-3 text-sm">
        <p>{t(isPollRefused ? "pollFailed" : "stalled")}</p>
        {isStalled && (
          <Button variant="outline" onClick={onResume}>
            {t("resume")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {isRunning ? t("running", { progress }) : t("starting")}
    </p>
  );
}
