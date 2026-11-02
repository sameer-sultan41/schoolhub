import { exportReport, runReport } from "./exam-reports-service";

export const ExamReportsService = {
  runReport,
  exportReport,
};

export type {
  ExamInlineReport,
  ExamQueuedReport,
  ExamReportFormValues,
  ExamReportKind,
  ExamReportQuery,
  ExamReportRow,
  ExamReportRowOf,
  ExamReportRun,
} from "./exam-reports-type";
