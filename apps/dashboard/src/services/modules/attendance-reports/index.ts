import { exportReport, runReport } from "./attendance-reports-service";

export const AttendanceReportsService = {
  runReport,
  exportReport,
};

export type {
  AttendanceReportRow,
  InlineReport,
  QueuedReport,
  ReportFormat,
  ReportFormValues,
  ReportKind,
  ReportKindFields,
  ReportQuery,
  ReportRowOf,
  ReportRun,
} from "./attendance-reports-type";
