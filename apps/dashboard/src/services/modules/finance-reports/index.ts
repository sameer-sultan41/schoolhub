import { exportReport, fetchReport, fetchStudentStatement } from "./finance-reports-service";

export const FinanceReportsService = {
  fetchReport,
  exportReport,
  fetchStudentStatement,
};

export type {
  FinanceReportDates,
  FinanceReportFormValues,
  FinanceReportGroupBy,
  FinanceReportKind,
  FinanceReportKindFields,
  FinanceReportQuery,
  FinanceReportRow,
  FinanceReportRowOf,
  FinanceReportRun,
  ReportFormat,
  StudentStatement,
  StudentStatementEntry,
} from "./finance-reports-type";
