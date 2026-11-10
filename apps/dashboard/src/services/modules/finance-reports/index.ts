import { exportReport, fetchReport } from "./finance-reports-service";

export const FinanceReportsService = {
  fetchReport,
  exportReport,
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
} from "./finance-reports-type";
