"use client";

import { useTranslations } from "next-intl";

import { ReportGrid, type ReportGridPaging } from "@/components/reports/report-grid";
import { enumLabel } from "@/lib/enum-label";
import type { FinanceReportGroupBy, FinanceReportRun } from "@/services";
import { financeRowsOfKind } from "@/services/modules/finance-reports/finance-reports-helper";
import { useLedgerReportColumns } from "./ledger-report-columns";
import { useStudentReportColumns } from "./report-columns";
import { REPORT_KIND_LABEL_KEY } from "./report-labels";

export interface ReportTableProps extends ReportGridPaging {
  report: FinanceReportRun;
  /** How the collection was grouped (its first column follows). */
  groupBy: FinanceReportGroupBy;
  /** A campus, session or class filter is set: a statement's running balance then covers only the lines kept. */
  filtered: boolean;
}

/**
 * An inline report's rows in a table whose columns depend on its kind: the rows are narrowed on
 * `row.kind`, so each kind's columns read only the fields its rows carry. The grid itself is the
 * shared `ReportGrid`.
 */
export function ReportTable({ report, groupBy, filtered, ...paging }: ReportTableProps) {
  const t = useTranslations("fees");
  const studentColumns = useStudentReportColumns(groupBy, filtered);
  const ledgerColumns = useLedgerReportColumns();
  const { rows } = report;
  const grid = {
    ...paging,
    title: enumLabel(t, REPORT_KIND_LABEL_KEY, report.kind),
    emptyDescription: t("reports.emptyDescription"),
  };

  switch (report.kind) {
    case "collection":
      return (
        <ReportGrid
          rows={financeRowsOfKind(rows, "collection")}
          columns={studentColumns.collection}
          {...grid}
        />
      );
    case "outstanding-aging":
      return (
        <ReportGrid
          rows={financeRowsOfKind(rows, "outstanding-aging")}
          columns={studentColumns["outstanding-aging"]}
          {...grid}
        />
      );
    case "student-ledger":
      return (
        <ReportGrid
          rows={financeRowsOfKind(rows, "student-ledger")}
          columns={studentColumns["student-ledger"]}
          {...grid}
        />
      );
    case "grant-register":
      return (
        <ReportGrid
          rows={financeRowsOfKind(rows, "grant-register")}
          columns={studentColumns["grant-register"]}
          {...grid}
        />
      );
    case "income-vs-expense":
      return (
        <ReportGrid
          rows={financeRowsOfKind(rows, "income-vs-expense")}
          columns={ledgerColumns["income-vs-expense"]}
          {...grid}
        />
      );
    case "budget-variance":
      return (
        <ReportGrid
          rows={financeRowsOfKind(rows, "budget-variance")}
          columns={ledgerColumns["budget-variance"]}
          {...grid}
        />
      );
    case "expense-register":
      return (
        <ReportGrid
          rows={financeRowsOfKind(rows, "expense-register")}
          columns={ledgerColumns["expense-register"]}
          {...grid}
        />
      );
    case "trial-balance":
      return (
        <ReportGrid
          rows={financeRowsOfKind(rows, "trial-balance")}
          columns={ledgerColumns["trial-balance"]}
          {...grid}
        />
      );
  }
}
