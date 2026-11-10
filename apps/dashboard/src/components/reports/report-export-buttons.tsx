"use client";

import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { useJobFileDownload } from "@/hooks/use-job-file-download";
import { REPORT_EXPORT_FORMATS, type ReportFormat } from "@/services/shared/report-export";

export interface ReportExportButtonsProps {
  /** Namespaces each export job's polling query key (the report module's query-key module). */
  module: string;
  /** Queues the report on screen in `format`: a `POST` answered `202` + a job. */
  start: (format: ReportFormat) => Promise<{ jobId: string }>;
  /** The downloaded file's name hint for `format`. */
  filenameFor: (format: ReportFormat) => string;
  /** Why the buttons are disabled (no export key, or permissions not yet known), shown as their
   * title; left out, they are enabled. A screen that hides them without the key omits it. */
  disabledReason?: string;
}

/**
 * Export CSV, XLSX and PDF: each a `POST` that queues a job, polled until its file downloads. Its
 * copy is the shared `reports` namespace; the attendance and exam reports use it.
 */
export function ReportExportButtons(props: ReportExportButtonsProps) {
  const t = useTranslations("reports");

  return (
    <div role="group" aria-label={t("export.label")} className="flex flex-wrap gap-2">
      {REPORT_EXPORT_FORMATS.map((format) => (
        <ReportExportButton key={format} format={format} {...props} />
      ))}
    </div>
  );
}

/** One format's button, with its own job: two formats can export side by side. */
function ReportExportButton({
  module,
  start,
  filenameFor,
  disabledReason,
  format,
}: ReportExportButtonsProps & { format: ReportFormat }) {
  const t = useTranslations("reports");
  const formatName = t(`formats.${format}`);

  const exportJob = useJobFileDownload({
    module,
    start: () => start(format),
    filename: filenameFor(format),
    messages: {
      startFailed: t("export.startFailed"),
      downloadFailed: t("export.downloadFailed"),
      timedOut: t("export.timedOut"),
      failed: t("export.failed"),
      success: () => t("export.success"),
    },
  });

  return (
    // On a wrapping `<span>`: a disabled button gets no hover, so it could not show its title.
    <span title={disabledReason}>
      <Button
        variant="outline"
        disabled={disabledReason !== undefined || exportJob.isBusy}
        onClick={() => {
          exportJob.run();
        }}
      >
        {exportJob.isBusy
          ? t("export.exporting", { format: formatName })
          : exportJob.isStalled
            ? t("export.checkStatus", { format: formatName })
            : t("export.button", { format: formatName })}
      </Button>
    </span>
  );
}
