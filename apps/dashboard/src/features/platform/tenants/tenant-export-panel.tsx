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
 * or fails. Download mints a fresh signed link per click (`:download`, audited on the server).
 * Starting again while one runs rejoins it (the server returns the queued or running job), so
 * a double click starts one export. The delete itself is the server's to allow: it accepts any
 * succeeded export of the school, from this panel or an earlier one, and answers 409
 * `export_required` without one or a waiver.
 */
export function TenantExportPanel({ tenantId }: { tenantId: string }) {
  const t = useTranslations("platform.lifecycle.delete.export");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  // One key per attempt: a retry after a lost answer replays its start. A failed job ends the
  // attempt, since the server would replay that key's 202 with the failed job.
  const keyRef = useRef<string>(crypto.randomUUID());
  const [jobId, setJobId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => Services.platform.exportTenant(tenantId, { idempotencyKey: keyRef.current }),
    onSuccess: (accepted) => {
      setJobId(accepted.job_id);
    },
  });
  // A fresh signed link per click: the poll carries none, and each download is audited.
  const download = useMutation({
    mutationFn: (id: string) => Services.platform.downloadTenantExport(tenantId, id),
    onSuccess: (link) => {
      downloadFile(link.download_url);
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
            if (watch.isTimedOut || watch.isError) {
              watch.resume();
              return;
            }
            if (job?.status === "failed") keyRef.current = crypto.randomUUID();
            start.mutate();
          }}
          disabled={job?.status === "succeeded"}
        >
          {watch.isTimedOut || watch.isError ? t("checkAgain") : t("start")}
        </Button>
        {job?.status === "succeeded" && (
          <Button
            type="button"
            variant="ghost"
            isLoading={download.isPending}
            loadingLabel={t("download")}
            onClick={() => {
              download.mutate(job.id);
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
      {(start.isError || job?.status === "failed" || watch.isError || download.isError) && (
        <Alert variant="destructive">
          <AlertDescription>
            {job?.status === "failed"
              ? (job.error ?? t("failed"))
              : resolveErrorMessage(
                  start.error ?? watch.error ?? download.error,
                  tErrors,
                  tCommon("submitFailed"),
                )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
