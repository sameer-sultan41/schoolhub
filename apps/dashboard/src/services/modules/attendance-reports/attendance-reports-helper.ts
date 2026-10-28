import { copyMappedFields, decimalFormat } from "@/lib/helpers";
import type { AttendanceMode } from "@/services/modules/attendance-settings/attendance-settings-type";
import {
  shiftIsoDate,
  toAttendanceMode,
} from "@/services/modules/student-attendance/student-attendance-helper";
import {
  REPORT_DEFAULT_RANGE_DAYS,
  REPORT_FILENAME_PREFIX,
  REPORT_FRACTION_DIGITS,
  REPORT_KIND_FIELDS,
  REPORT_QUERY_FIELDS,
} from "./attendance-reports-constant";
import { isValidThreshold } from "./attendance-reports.schema";
import type {
  AttendanceReportRow,
  ReportFormat,
  ReportFormValues,
  ReportKind,
  ReportQuery,
  ReportRowOf,
} from "./attendance-reports-type";

/** The attendance-reports module's pure helpers. */

export function isReportKind(value: string): value is ReportKind {
  return Object.hasOwn(REPORT_KIND_FIELDS, value);
}

/** A range report's default window: the last `REPORT_DEFAULT_RANGE_DAYS` days, today included. */
export function defaultReportRange(today: string): { from: string; to: string } {
  return { from: shiftIsoDate(today, 1 - REPORT_DEFAULT_RANGE_DAYS), to: today };
}

/** The dates the form shows and sends: the URL's, else the defaults. A single-day report's one
 * date is `from`, today unless set. */
export function effectiveReportDates(
  values: Pick<ReportFormValues, "kind" | "from" | "to">,
  today: string,
): { from: string; to: string } {
  if (isReportKind(values.kind) && REPORT_KIND_FIELDS[values.kind].singleDate) {
    const date = values.from || today;
    return { from: date, to: date };
  }
  const range = defaultReportRange(today);
  return { from: values.from || range.from, to: values.to || range.to };
}

/**
 * The report the form describes, or `null` while it can't be run (an unknown kind, a range that
 * ends before it starts, a threshold the API would refuse). Only the inputs the kind takes are
 * kept; a period applies only with a section.
 */
export function toReportQuery(values: ReportFormValues, today: string): ReportQuery | null {
  if (!isReportKind(values.kind)) return null;
  const fields = REPORT_KIND_FIELDS[values.kind];
  const { from, to } = effectiveReportDates(values, today);
  if (to < from) return null;
  if (fields.threshold && !isValidThreshold(values.threshold)) return null;
  const sectionId = fields.section && values.sectionId !== "" ? values.sectionId : undefined;
  return {
    kind: values.kind,
    startDate: from,
    endDate: fields.singleDate ? undefined : to,
    sectionId,
    periodId: fields.period && sectionId && values.periodId !== "" ? values.periodId : undefined,
    threshold: fields.threshold ? values.threshold.trim() : undefined,
  };
}

/** The report's query string (and the export's body, with its `format`). */
export function toReportQueryParams(query: ReportQuery): Record<string, string> {
  const params: Record<string, string> = { kind: query.kind };
  copyMappedFields(query, REPORT_QUERY_FIELDS, (value) => value !== undefined, params);
  return params;
}

/** Whether two reports send the same parameters (a re-run of the one on screen). */
export function isSameReport(a: ReportQuery, b: ReportQuery): boolean {
  return JSON.stringify(toReportQueryParams(a)) === JSON.stringify(toReportQueryParams(b));
}

/** The rows of one kind, narrowed on `row.kind`. */
export function rowsOfKind<K extends ReportKind>(
  rows: readonly AttendanceReportRow[],
  kind: K,
): ReportRowOf<K>[] {
  return rows.filter((row): row is ReportRowOf<K> => row.kind === kind);
}

/** A rate or an average with exactly one decimal place, in the viewer's locale. */
export function formatOneDecimal(value: number, locale: string): string {
  return decimalFormat(locale, REPORT_FRACTION_DIGITS, { fixed: true }).format(value);
}

/** A finished report job's file id, read without trusting the result's shape. */
export function jobResultFileId(result: Record<string, unknown> | null | undefined): string | null {
  const fileId = result?.result_file_id;
  return typeof fileId === "string" ? fileId : null;
}

/** A finished report job's `attendance_mode`, or `null` when the result names none. */
export function jobResultMode(
  result: Record<string, unknown> | null | undefined,
): AttendanceMode | null {
  const mode = result?.attendance_mode;
  return typeof mode === "string" ? toAttendanceMode(mode) : null;
}

/** The downloaded file's name hint, e.g. `attendance-report-defaulters-2026-10-01.xlsx`. */
export function reportFilename(query: ReportQuery, format: ReportFormat): string {
  return `${REPORT_FILENAME_PREFIX}-${query.kind}-${query.startDate}.${format}`;
}
