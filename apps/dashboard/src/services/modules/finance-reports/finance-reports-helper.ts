import { ApiError, type QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import { shiftIsoDate } from "@/services/modules/student-attendance/student-attendance-helper";
import {
  DEFAULT_FINANCE_REPORT_GROUPING,
  FINANCE_REPORT_DEFAULT_RANGE_DAYS,
  FINANCE_REPORT_FILENAME_PREFIX,
  FINANCE_REPORT_GROUPINGS,
  FINANCE_REPORT_KIND_FIELDS,
  FINANCE_REPORT_QUERY_FIELDS,
  FINANCE_REPORT_ROW_LIMIT_META_KEY,
} from "./finance-reports-constant";
import type {
  FinanceReportFormValues,
  FinanceReportGroupBy,
  FinanceReportKind,
  FinanceReportQuery,
  FinanceReportRow,
  FinanceReportRowOf,
  ReportFormat,
} from "./finance-reports-type";

/** The finance-reports module's pure helpers: plain data in, plain data out. */

export function isFinanceReportKind(value: string): value is FinanceReportKind {
  return Object.hasOwn(FINANCE_REPORT_KIND_FIELDS, value);
}

export function toFinanceReportGrouping(value: string): FinanceReportGroupBy {
  return (
    FINANCE_REPORT_GROUPINGS.find((grouping) => grouping === value) ??
    DEFAULT_FINANCE_REPORT_GROUPING
  );
}

/**
 * The dates the form shows and sends: the URL's, else the defaults. The collection (§8's
 * dashboard) and every one-date kind open on today; the other range reports on the last
 * `FINANCE_REPORT_DEFAULT_RANGE_DAYS` days. A one-date kind's date is `to`, the one the server
 * reads (`date_to` is the aging's as-of date); a kind with no dates sends today.
 */
export function effectiveFinanceReportDates(
  values: Pick<FinanceReportFormValues, "kind" | "from" | "to">,
  today: string,
): { from: string; to: string } {
  const dates = isFinanceReportKind(values.kind)
    ? FINANCE_REPORT_KIND_FIELDS[values.kind].dates
    : "range";
  if (dates === "none") return { from: today, to: today };
  if (dates === "asOf") {
    const asOf = values.to || today;
    return { from: asOf, to: asOf };
  }
  const opensOnToday = values.kind === "collection";
  const defaultFrom = opensOnToday
    ? today
    : shiftIsoDate(today, 1 - FINANCE_REPORT_DEFAULT_RANGE_DAYS);
  return { from: values.from || defaultFrom, to: values.to || today };
}

/**
 * The report the form describes, or `null` while it can't be run (an unknown kind, a range that
 * ends before it starts, a statement with no student). Only the inputs the kind takes are kept.
 */
export function toFinanceReportQuery(
  values: FinanceReportFormValues,
  today: string,
): FinanceReportQuery | null {
  if (!isFinanceReportKind(values.kind)) return null;
  const fields = FINANCE_REPORT_KIND_FIELDS[values.kind];
  const { from, to } = effectiveFinanceReportDates(values, today);
  if (to < from) return null;
  if (fields.student && values.student === "") return null;
  const pick = (enabled: boolean, value: string) => (enabled && value !== "" ? value : undefined);
  return {
    kind: values.kind,
    dateFrom: from,
    dateTo: to,
    studentId: pick(fields.student, values.student),
    groupBy: fields.groupBy ? toFinanceReportGrouping(values.group) : undefined,
    campusId: pick(fields.campus, values.campus),
    academicSessionId: pick(fields.session, values.session),
    classId: pick(fields.class, values.class),
  };
}

/** The report's query string (and the export's body, with its `format`). */
export function toFinanceReportParams(query: FinanceReportQuery): Record<string, string> {
  const params: Record<string, string> = { kind: query.kind };
  copyMappedFields(query, FINANCE_REPORT_QUERY_FIELDS, (value) => value !== undefined, params);
  return params;
}

export function toFinanceReportQueryParams(query: FinanceReportQuery): QueryParams {
  return toFinanceReportParams(query);
}

/** The rows of one kind, narrowed on `row.kind`. */
export function financeRowsOfKind<K extends FinanceReportKind>(
  rows: readonly FinanceReportRow[],
  kind: K,
): FinanceReportRowOf<K>[] {
  return rows.filter((row): row is FinanceReportRowOf<K> => row.kind === kind);
}

/**
 * The inline ceiling a too-large report was refused at (`meta.row_limit` on the 422), or `null`
 * for any other error: that one is shown as an error, this one as an offer to export.
 */
export function financeReportRowLimit(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const limit = error.meta[FINANCE_REPORT_ROW_LIMIT_META_KEY];
  return typeof limit === "number" ? limit : null;
}

/** The downloaded file's name hint, e.g. `fees-report-collection-2026-10-01.xlsx`. */
export function financeReportFilename(query: FinanceReportQuery, format: ReportFormat): string {
  return `${FINANCE_REPORT_FILENAME_PREFIX}-${query.kind}-${query.dateTo}.${format}`;
}
