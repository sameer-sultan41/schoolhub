"use client";

import { useTranslations } from "next-intl";

import { ReportGrid, type ReportGridPaging } from "@/components/reports/report-grid";
import type { ExamInlineReport } from "@/services";
import { examRowsOfKind } from "@/services/modules/exam-reports/exam-reports-helper";
import { useExamReportColumns } from "./exam-report-columns";

export interface ExamReportTableProps extends ReportGridPaging {
  report: ExamInlineReport;
}

/**
 * An inline exam report's rows in the shared `ReportGrid`, with its kind's columns: the rows are
 * narrowed on `row.kind`, so each kind's columns read only the fields its rows carry.
 */
export function ExamReportTable({ report, ...paging }: ExamReportTableProps) {
  const t = useTranslations("exams");
  const columns = useExamReportColumns();
  const { rows } = report;
  const grid = {
    ...paging,
    title: t(`reports.kinds.${report.kind}`),
    emptyDescription: t("reports.emptyDescription"),
  };

  switch (report.kind) {
    case "result-register": {
      const kindRows = examRowsOfKind(rows, "result-register");
      return <ReportGrid rows={kindRows} columns={columns["result-register"]} {...grid} />;
    }
    case "pass-fail-analysis": {
      const kindRows = examRowsOfKind(rows, "pass-fail-analysis");
      return <ReportGrid rows={kindRows} columns={columns["pass-fail-analysis"]} {...grid} />;
    }
    case "subject-performance": {
      const kindRows = examRowsOfKind(rows, "subject-performance");
      return <ReportGrid rows={kindRows} columns={columns["subject-performance"]} {...grid} />;
    }
    case "marks-entry-status": {
      const kindRows = examRowsOfKind(rows, "marks-entry-status");
      return <ReportGrid rows={kindRows} columns={columns["marks-entry-status"]} {...grid} />;
    }
    case "grade-distribution": {
      const kindRows = examRowsOfKind(rows, "grade-distribution");
      return <ReportGrid rows={kindRows} columns={columns["grade-distribution"]} {...grid} />;
    }
    case "question-bank-usage": {
      const kindRows = examRowsOfKind(rows, "question-bank-usage");
      return <ReportGrid rows={kindRows} columns={columns["question-bank-usage"]} {...grid} />;
    }
  }
}
