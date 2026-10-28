"use client";

import { useTranslations } from "next-intl";
import { Button } from "@schoolhub/ui";

import { useJobFileDownload } from "@/hooks/use-job-file-download";
import { Services, type ReportFormat, type ReportQuery } from "@/services";
import {
  ATTENDANCE_REPORTS_QUERY_MODULE,
  REPORT_EXPORT_FORMATS,
} from "@/services/modules/attendance-reports/attendance-reports-constant";
import { reportFilename } from "@/services/modules/attendance-reports/attendance-reports-helper";

export interface ReportExportButtonsProps {
  /** The report on screen: the export carries the same parameters. */
  query: ReportQuery;
  /** Why the buttons are disabled (no `attendance.report.export`, or permissions not yet known);
   * `undefined` enables them. */
  disabledReason: string | undefined;
}

/** Export CSV, XLSX and PDF: each a `POST` that queues a job, polled until its file downloads. */
export function ReportExportButtons({ query, disabledReason }: ReportExportButtonsProps) {
  const t = useTranslations("attendance");

  return (
    <div role="group" aria-label={t("reports.export.label")} className="flex flex-wrap gap-2">
      {REPORT_EXPORT_FORMATS.map((format) => (
        <ReportExportButton
          key={format}
          query={query}
          format={format}
          disabledReason={disabledReason}
        />
      ))}
    </div>
  );
}

/** One format's button, with its own job: two formats can export side by side. */
function ReportExportButton({
  query,
  format,
  disabledReason,
}: ReportExportButtonsProps & { format: ReportFormat }) {
  const t = useTranslations("attendance");
  const formatName = t(`reports.formats.${format}`);

  const exportJob = useJobFileDownload<ReportQuery>({
    module: ATTENDANCE_REPORTS_QUERY_MODULE,
    start: (exported) => Services.attendanceReports.exportReport(exported, format),
    filename: reportFilename(query, format),
    messages: {
      startFailed: t("reports.export.startFailed"),
      downloadFailed: t("reports.export.downloadFailed"),
      timedOut: t("reports.export.timedOut"),
      failed: t("reports.export.failed"),
      success: () => t("reports.export.success"),
    },
  });

  return (
    // On a wrapping `<span>`: a disabled button gets no hover, so it could not show its title.
    <span title={disabledReason}>
      <Button
        variant="outline"
        disabled={disabledReason !== undefined || exportJob.isBusy}
        onClick={() => {
          exportJob.run(query);
        }}
      >
        {exportJob.isBusy
          ? t("reports.export.exporting", { format: formatName })
          : exportJob.isStalled
            ? t("reports.export.checkStatus", { format: formatName })
            : t("reports.export.button", { format: formatName })}
      </Button>
    </span>
  );
}
