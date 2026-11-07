"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button } from "@schoolhub/ui";
import { Loader2 } from "lucide-react";

import { generationCounts } from "@/services/modules/fee-invoices/fee-invoices-helper";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";

export interface GenerationResultProps {
  /** The finished job, once it ended; `undefined` while it runs or is stalled. */
  job: BackgroundJobRecord | undefined;
  isRunning: boolean;
  isStalled: boolean;
  isPollRefused: boolean;
  progress: number;
  onResume: () => void;
}

/**
 * The generation's progress and end, in the dialog's body. The counts are the job's own
 * (`issued`, `skipped`): never a tally made here. A run that skips everyone is a success that
 * says nobody was left to bill, not an error; a failed job shows the server's own sentence.
 */
export function GenerationResult({
  job,
  isRunning,
  isStalled,
  isPollRefused,
  progress,
  onResume,
}: GenerationResultProps) {
  const t = useTranslations("fees");

  if (job?.status === "failed") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{job.error ?? t("invoices.generate.failed")}</AlertDescription>
      </Alert>
    );
  }

  if (job?.status === "succeeded") {
    const { issued, skipped } = generationCounts(job.result);
    const nothingNew = issued === 0 && skipped > 0;
    return (
      <div role="status" className="space-y-1 text-sm">
        <p className="font-medium text-foreground">
          {nothingNew
            ? t("invoices.generate.nothingNew")
            : t("invoices.generate.created", { count: issued })}
        </p>
        <p className="text-muted-foreground">
          {t("invoices.generate.skipped", { count: skipped })}
        </p>
      </div>
    );
  }

  if (isStalled || isPollRefused) {
    return (
      <div role="status" className="space-y-3 text-sm">
        <p>{t(isPollRefused ? "invoices.generate.pollFailed" : "invoices.generate.stalled")}</p>
        {isStalled && (
          <Button variant="outline" onClick={onResume}>
            {t("invoices.generate.resume")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {isRunning ? t("invoices.generate.running", { progress }) : t("invoices.generate.starting")}
    </p>
  );
}
