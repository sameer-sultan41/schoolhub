"use client";

import { useTranslations } from "next-intl";
import { skipToken, useQuery } from "@tanstack/react-query";
import { Card, CardContent, EmptyState, Skeleton } from "@schoolhub/ui";
import { CalendarX, UserSearch } from "lucide-react";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { LoadErrorCard } from "@/components/load-error-card";
import { ReportExportButtons } from "@/components/reports/report-export-buttons";
import { useCurrentUser } from "@/hooks/use-current-user";
import { foldUnknownFieldErrors, NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  FINANCE_REPORT_RESOURCE,
  FINANCE_REPORTS_QUERY_MODULE,
} from "@/services/modules/finance-reports/finance-reports-constant";
import {
  financeReportFilename,
  financeReportRowLimit,
  toFinanceReportGrouping,
  toFinanceReportParams,
} from "@/services/modules/finance-reports/finance-reports-helper";
import { ReportForm } from "./report-form";
import { ReportTable } from "./report-table";
import { ReportTooLargeCard } from "./report-too-large-card";
import { useReportForm } from "./use-report-form";
import { useReportReferences } from "./use-report-references";

/**
 * `/fees/reports`: one of eight §13 reports, its dates and filters (all in the URL), and the
 * report on screen. It opens on today's collection (§8's collection dashboard), and
 * `group_by=cashier` is §6's per-cashier register. Up to 1000 rows come back as a table; a
 * larger report is refused with `meta.row_limit`, which this shows as an offer to export rather
 * than an error. Export (CSV, XLSX, PDF) needs `fees.report.export` and is hidden without it.
 * The section is gated on `fees.report.view`.
 */
export function ReportsHome() {
  const t = useTranslations("fees");
  const tErrors = useTranslations("errors");
  const { data: user } = useCurrentUser();
  const form = useReportForm();
  const references = useReportReferences();
  const { query } = form;

  const canExport = hasPermission(user, "fees.report.export");

  const report = useQuery({
    queryKey: queryKeys.list(
      FINANCE_REPORTS_QUERY_MODULE,
      FINANCE_REPORT_RESOURCE,
      query ? toFinanceReportParams(query) : {},
    ),
    queryFn: query ? () => Services.financeReports.fetchReport(query) : skipToken,
  });

  function results() {
    if (query === null) {
      const needsStudent = form.fields?.student === true && form.values.student === "";
      return (
        <Card>
          <CardContent>
            <EmptyState
              icon={needsStudent ? UserSearch : CalendarX}
              title={t(needsStudent ? "reports.pickStudent.title" : "reports.invalid.title")}
              description={t(
                needsStudent ? "reports.pickStudent.description" : "reports.invalid.description",
              )}
            />
          </CardContent>
        </Card>
      );
    }
    const rowLimit = financeReportRowLimit(report.error);
    if (rowLimit !== null) {
      return <ReportTooLargeCard query={query} rowLimit={rowLimit} canExport={canExport} />;
    }
    if (report.isError) {
      return (
        <LoadErrorCard
          // A refusal's own reason (a bad filter) is the useful text, whatever field it names.
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
          <span className="sr-only">{t("reports.loading")}</span>
          <Skeleton className="h-96 w-full" />
        </div>
      );
    }
    return (
      <ReportTable
        report={report.data}
        groupBy={toFinanceReportGrouping(form.values.group)}
        pagination={form.pagination}
        onPaginationChange={form.onPaginationChange}
        actions={
          canExport ? (
            <ReportExportButtons
              module={FINANCE_REPORTS_QUERY_MODULE}
              start={(format) => Services.financeReports.exportReport(query, format)}
              filenameFor={(format) => financeReportFilename(query, format)}
            />
          ) : undefined
        }
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
          fields={form.fields}
          campuses={references.campuses}
          sessions={references.sessions}
          classes={references.classes}
          canPickStudent={references.canReadStudents}
          onChange={form.setFilters}
        />
        {results()}
      </div>
    </>
  );
}
