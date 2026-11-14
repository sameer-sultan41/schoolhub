"use client";

import { useTranslations } from "next-intl";
import { Card, EmptyState } from "@schoolhub/ui";
import { FileDown } from "lucide-react";

import { ReportExportButtons } from "@/components/reports/report-export-buttons";
import { Services, type FinanceReportQuery } from "@/services";
import { FINANCE_REPORTS_QUERY_MODULE } from "@/services/modules/finance-reports/finance-reports-constant";
import { financeReportFilename } from "@/services/modules/finance-reports/finance-reports-helper";

export interface ReportTooLargeCardProps {
  query: FinanceReportQuery;
  /** The inline ceiling the server named (`meta.row_limit`). */
  rowLimit: number;
  /** `fees.report.export`: the offer is a sentence without the buttons for anyone who lacks it. */
  canExport: boolean;
}

/**
 * A report over the inline ceiling (the server's 422 with `meta.row_limit`). It is not a failure:
 * the same report exports as a file, so this says so and, for a holder of `fees.report.export`,
 * offers CSV, XLSX and PDF. Each is a `POST` that queues a job, polled until its file downloads.
 */
export function ReportTooLargeCard({ query, rowLimit, canExport }: ReportTooLargeCardProps) {
  const t = useTranslations("fees");

  return (
    <Card>
      <EmptyState
        icon={FileDown}
        title={t("reports.tooLarge.title")}
        description={t(canExport ? "reports.tooLarge.description" : "reports.tooLarge.noExport", {
          limit: rowLimit,
        })}
      />
      {canExport && (
        <div className="flex justify-center px-6 pb-6">
          <ReportExportButtons
            module={FINANCE_REPORTS_QUERY_MODULE}
            start={(format) => Services.financeReports.exportReport(query, format)}
            filenameFor={(format) => financeReportFilename(query, format)}
          />
        </div>
      )}
    </Card>
  );
}
