"use client";

import { useTranslations } from "next-intl";

import { ReportGrid, type ReportGridPaging } from "@/components/reports/report-grid";
import type { InlineReport } from "@/services";
import { rowsOfKind } from "@/services/modules/attendance-reports/attendance-reports-helper";
import { useReportColumns } from "./report-columns";

export interface ReportTableProps extends ReportGridPaging {
  report: InlineReport;
}

/**
 * An inline report's rows in a table whose columns depend on its kind: the rows are narrowed on
 * `row.kind`, so each kind's columns read only the fields its rows carry. The grid itself is the
 * shared `ReportGrid`.
 */
export function ReportTable({ report, ...paging }: ReportTableProps) {
  const t = useTranslations("attendance");
  const columns = useReportColumns();
  const { rows } = report;
  const grid = {
    ...paging,
    title: t(`reports.kinds.${report.kind}`),
    emptyDescription: t("reports.emptyDescription"),
  };

  switch (report.kind) {
    case "daily-register": {
      const kindRows = rowsOfKind(rows, "daily-register");
      return <ReportGrid rows={kindRows} columns={columns["daily-register"]} {...grid} />;
    }
    case "student-summary": {
      const kindRows = rowsOfKind(rows, "student-summary");
      return <ReportGrid rows={kindRows} columns={columns["student-summary"]} {...grid} />;
    }
    case "defaulters": {
      const kindRows = rowsOfKind(rows, "defaulters");
      return <ReportGrid rows={kindRows} columns={columns.defaulters} {...grid} />;
    }
    case "student-late-arrivals": {
      const kindRows = rowsOfKind(rows, "student-late-arrivals");
      return <ReportGrid rows={kindRows} columns={columns["student-late-arrivals"]} {...grid} />;
    }
    case "staff-punctuality": {
      const kindRows = rowsOfKind(rows, "staff-punctuality");
      return <ReportGrid rows={kindRows} columns={columns["staff-punctuality"]} {...grid} />;
    }
    case "leave": {
      const kindRows = rowsOfKind(rows, "leave");
      return <ReportGrid rows={kindRows} columns={columns.leave} {...grid} />;
    }
  }
}
