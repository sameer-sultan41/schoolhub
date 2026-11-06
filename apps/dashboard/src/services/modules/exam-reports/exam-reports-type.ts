import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017): every row carries its report's `kind` (ADR-0022). */
export type ExamReportRow = ApiSchemas["ExamReportRow"];
export type ExamReportKind = ApiSchemas["ExamReportQueryKindEnum"];

/** The row type of one report, narrowed on its `kind`. */
export type ExamReportRowOf<K extends ExamReportKind> = Extract<ExamReportRow, { kind: K }>;

/** A report's parameters: `examId` for every kind but `question-bank-usage`, which is about the
 * school's banks rather than an exam. */
export interface ExamReportQuery {
  kind: ExamReportKind;
  examId?: string;
}

/** A report small enough to come back inline (≤ 1000 rows). */
export interface ExamInlineReport {
  kind: ExamReportKind;
  rows: ExamReportRow[];
}

/** A report too large to return inline: the server built it as a CSV job instead. */
export interface ExamQueuedReport {
  jobId: string;
}

export type ExamReportRun = ExamInlineReport | ExamQueuedReport;

/** The report form as the URL holds it (`EXAM_REPORT_URL_FILTERS`), a blank exam as `""`. */
export interface ExamReportFormValues {
  kind: string;
  exam: string;
}
