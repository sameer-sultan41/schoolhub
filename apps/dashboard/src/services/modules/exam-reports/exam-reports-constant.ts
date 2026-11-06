import { isUuid } from "@/lib/helpers";
import type { ExamReportKind } from "./exam-reports-type";

/** The exam-reports module's constants. */

/** The query-key module a report run lives under, and the job watches its exports use. */
export const EXAM_REPORTS_QUERY_MODULE = "exam-reports";
export const EXAM_REPORT_RESOURCE = "report";

/** Whether each kind is about one exam, keyed so the compiler checks it against the generated
 * enum (`ExamReportQuerySerializer.validate`: every kind but question-bank usage names one). */
export const EXAM_REPORT_NEEDS_EXAM: Record<ExamReportKind, boolean> = {
  "result-register": true,
  "pass-fail-analysis": true,
  "subject-performance": true,
  "marks-entry-status": true,
  "grade-distribution": true,
  "question-bank-usage": false,
};

/** The kinds in the picker's order (`reports.REPORT_KINDS`). */
export const EXAM_REPORT_KINDS: readonly ExamReportKind[] = [
  "result-register",
  "pass-fail-analysis",
  "subject-performance",
  "marks-entry-status",
  "grade-distribution",
  "question-bank-usage",
];

export const DEFAULT_EXAM_REPORT_KIND: ExamReportKind = "result-register";

/** The kinds about no exam: all a viewer without `exams.exam.view` (who cannot read `/exams` to
 * pick one) is offered. The fallback stands in when the URL names a kind they are not offered. */
export const NO_EXAM_KINDS = EXAM_REPORT_KINDS.filter((kind) => !EXAM_REPORT_NEEDS_EXAM[kind]);
export const NO_EXAM_FALLBACK_KIND: ExamReportKind = "question-bank-usage";

/** The report form's URL keys. */
export const EXAM_REPORT_URL_KEYS = { kind: "kind", exam: "exam" } as const;

const isUuidOrEmpty = (value: string) => value === "" || isUuid(value);

/** The report form's URL filters (`useDataGridUrlState`). */
export const EXAM_REPORT_URL_FILTERS = {
  [EXAM_REPORT_URL_KEYS.kind]: {
    default: DEFAULT_EXAM_REPORT_KIND,
    isValid: (value: string) => Object.hasOwn(EXAM_REPORT_NEEDS_EXAM, value),
  },
  [EXAM_REPORT_URL_KEYS.exam]: { default: "", isValid: isUuidOrEmpty },
};

/** The report table keeps the server's row order, and its columns change with the kind. */
export const EXAM_REPORT_SORTABLE_IDS: readonly string[] = [];
export const EXAM_REPORT_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const EXAM_REPORT_HIDEABLE_IDS: readonly string[] = [];

/** A percentage, an average and a rate are shown to at most this many decimal places (the
 * server's own rounding: 2 for marks and percentages, 1 for a rate). */
export const EXAM_REPORT_FRACTION_DIGITS = 2;

/** The downloaded file's name hint (the server's `Content-Disposition` wins cross-origin). */
export const EXAM_REPORT_FILENAME_PREFIX = "exam-report";
