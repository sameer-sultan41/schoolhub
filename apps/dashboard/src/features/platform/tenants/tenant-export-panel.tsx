"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Button } from "@schoolhub/ui";
import { Download } from "lucide-react";

import { useJobWatch } from "@/hooks/use-job-polling";
import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";
import { Services } from "@/services";
import { PLATFORM_QUERY_MODULE } from "@/services/modules/platform/platform-constant";

/**
 * "Export first": starts the school's export (`:export`, a job) and polls it until it succeeds
 * or fails, then offers its signed download link. Starting again while one runs rejoins it
 * (the server returns the queued or running job), so a double click starts one export. The
 * delete itself is the server's to allow: it accepts any succeeded export of the school, from
 * this panel or an earlier one, and answers 409 `export_required` without one or a waiver.
 */
export function TenantExportPanel({ tenantId }: { tenantId: string }) {
  const t = useTranslations("platform.lifecycle.delete.export");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  // One key per panel: a retry after a lost answer replays the first start.
  const keyRef = useRef<string>(crypto.randomUUID());
  const [jobId, setJobId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => Services.platform.exportTenant(tenantId, { idempotencyKey: keyRef.current }),
    onSuccess: (accepted) => {
      setJobId(accepted.jobId);
    },
  });

  const watch = useJobWatch(PLATFORM_QUERY_MODULE, jobId, (id) =>
    Services.platform.fetchTenantJob(tenantId, id),
  );
  const job = watch.job;

  const isBusy = start.isPending || watch.isPolling;

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-sm text-muted-foreground">{t("summary")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          isLoading={isBusy}
          loadingLabel={t("running", { progress: job?.progress ?? 0 })}
          onClick={() => {
            if (watch.isTimedOut || watch.isError) watch.resume();
            else start.mutate();
          }}
          disabled={job?.status === "succeeded"}
        >
          {watch.isTimedOut || watch.isError ? t("checkAgain") : t("start")}
        </Button>
        {job?.status === "succeeded" && job.download_url && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (job.download_url) downloadFile(job.download_url);
            }}
          >
            <Download aria-hidden="true" />
            {t("download")}
          </Button>
        )}
      </div>
      <p role="status" className="text-sm">
        {job?.status === "succeeded"
          ? t("succeeded")
          : watch.isTimedOut
            ? t("timedOut")
            : isBusy
              ? t("progress", { progress: job?.progress ?? 0 })
              : null}
      </p>
      {(start.isError || job?.status === "failed" || watch.isError) && (
        <Alert variant="destructive">
          <AlertDescription>
            {job?.status === "failed"
              ? (job.error ?? t("failed"))
              : resolveErrorMessage(start.error ?? watch.error, tErrors, tCommon("submitFailed"))}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
