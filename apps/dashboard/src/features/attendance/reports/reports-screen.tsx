"use client";

import { useState } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Card, EmptyState, Skeleton } from "@schoolhub/ui";
import { FileChartColumn } from "lucide-react";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type AttendanceMode, type ReportQuery } from "@/services";
import { DAILY_ATTENDANCE_MODE } from "@/services/modules/attendance-settings/attendance-settings-constant";
import {
  ATTENDANCE_REPORTS_QUERY_MODULE,
  QUEUED_REPORT_FORMAT,
  REPORT_RESOURCE,
} from "@/services/modules/attendance-reports/attendance-reports-constant";
import {
  isSameReport,
  reportFilename,
  toReportQueryParams,
} from "@/services/modules/attendance-reports/attendance-reports-helper";
import { ReportExportButtons } from "./report-export-buttons";
import { ReportForm } from "./report-form";
import { ReportJobPanel } from "./report-job-panel";
import { ReportTable } from "./report-table";
import { useReportForm } from "./use-report-form";

/**
 * `/attendance/reports`: pick one of six reports, its dates and filters (all kept in the URL),
 * and run it. Up to 1000 rows come back as a table whose columns follow the report; a larger
 * report is a `202` the screen polls until its CSV is ready to download. A holder of
 * `attendance.report.export` can export the report on screen as CSV, XLSX or PDF. Once the form
 * no longer describes the report on screen, a hint says so: the table and its exports stay the
 * last run's until Run report is pressed again.
 */
export function ReportsScreen() {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: currentUser, isError: isUserError } = useCurrentUser();
  // The tenant's mode, as the last report response told it; `null` until one has.
  const [lastMode, setLastMode] = useState<AttendanceMode | null>(null);
  const form = useReportForm({ periodMode: lastMode !== DAILY_ATTENDANCE_MODE });
  const { draft, setPageIndex, writeKind } = form;

  // The report on screen: what Run report last ran, or what a shared link names on arrival.
  const [applied, setApplied] = useState<ReportQuery | null>(() =>
    form.linksToReport ? draft : null,
  );

  const report = useQuery({
    queryKey: queryKeys.list(
      ATTENDANCE_REPORTS_QUERY_MODULE,
      REPORT_RESOURCE,
      applied ? toReportQueryParams(applied) : {},
    ),
    queryFn: applied ? () => Services.attendanceReports.runReport(applied) : skipToken,
  });

  // An inline answer carries the mode; a job's result reports it through `onModeKnown`.
  const inlineMode =
    report.data !== undefined && !("jobId" in report.data) ? report.data.attendanceMode : null;
  if (inlineMode !== null && inlineMode !== lastMode) setLastMode(inlineMode);

  const isStale = applied !== null && (draft === null || !isSameReport(applied, draft));

  function run() {
    if (!draft) return;
    setPageIndex(0);
    writeKind();
    // The same report again is a refresh, not a cache hit.
    if (applied && isSameReport(applied, draft)) void report.refetch();
    else setApplied(draft);
  }

  const exportDisabledReason = !currentUser
    ? tCommon(isUserError ? "permissionsLoadFailed" : "permissionsLoading")
    : hasPermission(currentUser, "attendance.report.export")
      ? undefined
      : t("reports.export.permissionTitle");

  function results() {
    if (!applied) {
      return (
        <Card>
          <EmptyState
            icon={FileChartColumn}
            title={t("reports.notRunTitle")}
            description={t("reports.notRunDescription")}
          />
        </Card>
      );
    }
    if (report.isError) {
      return (
        <LoadErrorCard
          // A refusal's own reason (a bad range, a threshold) is the useful text, whatever field.
          message={resolveErrorMessage(
            foldUnknownFieldErrors(report.error),
            tErrors,
            t("reports.loadError"),
            NON_FIELD,
          )}
          onRetry={() => {
            void report.refetch();
          }}
        />
      );
    }
    if (report.data === undefined) {
      return (
        <div role="status" aria-busy="true">
          <span className="sr-only">{t("reports.form.running")}</span>
          <Skeleton className="h-96 w-full" />
        </div>
      );
    }
    const exportButtons = (
      <ReportExportButtons query={applied} disabledReason={exportDisabledReason} />
    );
    if ("jobId" in report.data) {
      return (
        <div className="space-y-4">
          <div className="flex justify-end">{exportButtons}</div>
          <ReportJobPanel
            jobId={report.data.jobId}
            filename={reportFilename(applied, QUEUED_REPORT_FORMAT)}
            onModeKnown={setLastMode}
            onRestart={() => {
              void report.refetch();
            }}
          />
        </div>
      );
    }
    return (
      <ReportTable
        report={report.data}
        pagination={form.pagination}
        onPaginationChange={form.onPaginationChange}
        actions={exportButtons}
      />
    );
  }

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("reports.title")} description={t("reports.summary")} />
      </Toolbar>
      <div className="space-y-4">
        <ReportForm
          values={form.values}
          sections={form.sections}
          periods={form.periods}
          showPeriod={form.showPeriod}
          thresholdInvalid={form.thresholdInvalid}
          canRun={draft !== null}
          isRunning={report.isFetching}
          onChange={form.setFilters}
          onRun={run}
        />
        {isStale && (
          <Alert variant="info">
            <AlertDescription>{t("reports.stale")}</AlertDescription>
          </Alert>
        )}
        {results()}
      </div>
    </>
  );
}
