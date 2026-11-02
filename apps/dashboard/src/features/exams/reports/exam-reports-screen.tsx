"use client";

import { useState } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, Card, EmptyState, Skeleton } from "@schoolhub/ui";
import { FileChartColumn } from "lucide-react";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { ReportExportButtons } from "@/components/reports/report-export-buttons";
import { ReportJobPanel } from "@/components/reports/report-job-panel";
import { useExamOptions } from "@/features/exams/use-exam-options";
import { useCurrentUser } from "@/hooks/use-current-user";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type ExamReportQuery } from "@/services";
import {
  EXAM_REPORT_RESOURCE,
  EXAM_REPORTS_QUERY_MODULE,
} from "@/services/modules/exam-reports/exam-reports-constant";
import {
  examReportFilename,
  isSameExamReport,
  toExamReportQueryParams,
} from "@/services/modules/exam-reports/exam-reports-helper";
import { QUEUED_REPORT_FORMAT } from "@/services/shared/report-export";
import { ExamReportForm } from "./exam-report-form";
import { ExamReportTable } from "./exam-report-table";
import { useExamReportForm } from "./use-exam-report-form";

/**
 * `/exams/reports`: pick one of §13's six reports and, for all but question-bank usage, its exam
 * (both kept in the URL), and run it. Up to 1000 rows come back as a table whose columns follow
 * the report; a larger report is a `202` the screen polls until its CSV is ready to download. A
 * holder of `exams.result.export` can export the report on screen as CSV, XLSX or PDF; without it
 * the buttons are not shown. Once the form no longer describes the report on screen, a hint says
 * so: the table and its exports stay the last run's until Run report is pressed again. The form
 * waits for the viewer's keys: the per-exam kinds need `exams.exam.view` (the exam picker reads
 * `/exams`), so without it only question-bank usage is offered, with a note saying why.
 */
export function ExamReportsScreen() {
  const tCommon = useTranslations("common");
  const { data: currentUser, isError } = useCurrentUser();

  if (!currentUser) {
    return isError ? (
      <Alert variant="destructive">
        <AlertDescription>{tCommon("permissionsLoadFailed")}</AlertDescription>
      </Alert>
    ) : (
      <div role="status" aria-busy="true">
        <span className="sr-only">{tCommon("permissionsLoading")}</span>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  return (
    <ExamReports
      canPickExam={hasPermission(currentUser, "exams.exam.view")}
      canExport={hasPermission(currentUser, "exams.result.export")}
    />
  );
}

/** The screen once the viewer's keys are known, so a shared link's first render already knows
 * which kinds are offered. */
function ExamReports({ canPickExam, canExport }: { canPickExam: boolean; canExport: boolean }) {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const form = useExamReportForm({ canPickExam });
  const { draft, setPageIndex, writeKind } = form;
  const examsQuery = useExamOptions({ enabled: canPickExam && form.showExam });

  // The report on screen: what Run report last ran, or what a shared link names on arrival.
  const [applied, setApplied] = useState<ExamReportQuery | null>(() =>
    form.linksToReport ? draft : null,
  );

  const report = useQuery({
    queryKey: queryKeys.list(
      EXAM_REPORTS_QUERY_MODULE,
      EXAM_REPORT_RESOURCE,
      applied ? toExamReportQueryParams(applied) : {},
    ),
    queryFn: applied ? () => Services.examReports.runReport(applied) : skipToken,
  });

  const isStale = applied !== null && (draft === null || !isSameExamReport(applied, draft));

  function run() {
    if (!draft) return;
    setPageIndex(0);
    writeKind();
    // The same report again is a refresh, not a cache hit.
    if (applied && isSameExamReport(applied, draft)) void report.refetch();
    else setApplied(draft);
  }

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
          // A refusal's own reason (an exam out of scope, a missing exam) is the useful text.
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
    const exportButtons = canExport && (
      <ReportExportButtons
        module={EXAM_REPORTS_QUERY_MODULE}
        start={(format) => Services.examReports.exportReport(applied, format)}
        filenameFor={(format) => examReportFilename(applied, format)}
      />
    );
    if ("jobId" in report.data) {
      return (
        <div className="space-y-4">
          {exportButtons && <div className="flex justify-end">{exportButtons}</div>}
          <ReportJobPanel
            module={EXAM_REPORTS_QUERY_MODULE}
            jobId={report.data.jobId}
            filename={examReportFilename(applied, QUEUED_REPORT_FORMAT)}
            onRestart={() => {
              void report.refetch();
            }}
          />
        </div>
      );
    }
    return (
      <ExamReportTable
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
        <ExamReportForm
          kinds={form.kinds}
          values={form.values}
          exams={examsQuery.data ?? []}
          showExam={form.showExam}
          canRun={draft !== null}
          isRunning={report.isFetching}
          onChange={form.setFilters}
          onRun={run}
        />
        {!canPickExam && (
          <Alert variant="info">
            <AlertDescription>{t("reports.form.examAccessNote")}</AlertDescription>
          </Alert>
        )}
        {form.showExam && examsQuery.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t("reports.form.examsLoadError")}</AlertDescription>
          </Alert>
        )}
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
