import { decimalFormat } from "@/lib/helpers";
import type { ReportFormat } from "@/services/shared/report-export";
import {
  EXAM_REPORT_FILENAME_PREFIX,
  EXAM_REPORT_FRACTION_DIGITS,
  EXAM_REPORT_NEEDS_EXAM,
} from "./exam-reports-constant";
import type {
  ExamReportFormValues,
  ExamReportKind,
  ExamReportQuery,
  ExamReportRow,
  ExamReportRowOf,
} from "./exam-reports-type";

/** The exam-reports module's pure helpers. */

export function isExamReportKind(value: string): value is ExamReportKind {
  return Object.hasOwn(EXAM_REPORT_NEEDS_EXAM, value);
}

/** The report the form describes, or `null` while it can't run (an unknown kind, or a kind about
 * one exam with none picked). The exam is sent only for a kind about one. */
export function toExamReportQuery(values: ExamReportFormValues): ExamReportQuery | null {
  if (!isExamReportKind(values.kind)) return null;
  if (!EXAM_REPORT_NEEDS_EXAM[values.kind]) return { kind: values.kind };
  return values.exam === "" ? null : { kind: values.kind, examId: values.exam };
}

/** The report's query string (and the export's body, with its `format`). */
export function toExamReportQueryParams(query: ExamReportQuery): Record<string, string> {
  return query.examId === undefined
    ? { kind: query.kind }
    : { kind: query.kind, exam_id: query.examId };
}

/** Whether two reports send the same parameters (a re-run of the one on screen). */
export function isSameExamReport(a: ExamReportQuery, b: ExamReportQuery): boolean {
  return a.kind === b.kind && a.examId === b.examId;
}

/** The rows of one kind, narrowed on `row.kind`. */
export function examRowsOfKind<K extends ExamReportKind>(
  rows: readonly ExamReportRow[],
  kind: K,
): ExamReportRowOf<K>[] {
  return rows.filter((row): row is ExamReportRowOf<K> => row.kind === kind);
}

/** The downloaded file's name hint, e.g. `exam-report-result-register.xlsx`. */
export function examReportFilename(query: ExamReportQuery, format: ReportFormat): string {
  return `${EXAM_REPORT_FILENAME_PREFIX}-${query.kind}.${format}`;
}

/** A mark, percentage, average or rate as the server rounded it, in the viewer's locale. */
export function formatExamFigure(value: number, locale: string): string {
  return decimalFormat(locale, EXAM_REPORT_FRACTION_DIGITS).format(value);
}
