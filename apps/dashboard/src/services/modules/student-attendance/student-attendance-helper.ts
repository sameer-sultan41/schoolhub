import { ApiError } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import type { AttendanceMode } from "@/services/modules/attendance-settings/attendance-settings-type";
import {
  ATTENDANCE_QUERY_FIELDS,
  BULK_MARK_BODY_FIELDS,
  BULK_MARK_ENTRY_FIELDS,
  DEFAULT_ATTENDANCE_MODE,
  LOCK_FILTER_LOCKED,
  LOCK_FILTER_OPEN,
  MARKABLE_STATUSES,
  PERIOD_ATTENDANCE_MODE,
  RECORDS_DEFAULT_RANGE_DAYS,
  UNMARKABLE_REASONS,
} from "./student-attendance-constant";
import type {
  AttendancePageQuery,
  AttendanceStatus,
  BulkMarkInput,
  BulkMarkMeta,
  MarkableStatus,
  RegisterMeta,
  RegisterResult,
  RowIssue,
  StudentAttendanceRecord,
  UnmarkableReason,
} from "./student-attendance-type";

/** The student-attendance module's pure helpers. */

export function toAttendanceQueryParams(
  query: AttendancePageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  // `isLocked: false` is a real filter, so only an undefined or blank value is left out.
  copyMappedFields(
    query,
    ATTENDANCE_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

const MS_PER_DAY = 86_400_000;
const ISO_DATE_LENGTH = 10;

/** `date` (`YYYY-MM-DD`) moved by `days` calendar days, in UTC so no clock change shifts it. */
export function shiftIsoDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY);
  return shifted.toISOString().slice(0, ISO_DATE_LENGTH);
}

/** The Records list's default window: the last `RECORDS_DEFAULT_RANGE_DAYS` days, `today`
 * included. */
export function defaultRecordsRange(today: string): { from: string; to: string } {
  return { from: shiftIsoDate(today, 1 - RECORDS_DEFAULT_RANGE_DAYS), to: today };
}

/** The status filter's URL value as the list's `status`; `all` is no filter. */
export function statusFilterToStatus(value: string): AttendanceStatus | undefined {
  return value === FILTER_ALL ? undefined : (value as AttendanceStatus);
}

/** The locked filter's URL value as the list's `is_locked`; `all` is no filter. */
export function lockFilterToIsLocked(value: string): boolean | undefined {
  if (value === LOCK_FILTER_LOCKED) return true;
  return value === LOCK_FILTER_OPEN ? false : undefined;
}

/** The `:bulk-mark` body. A null `period_id` is sent (daily mode); an unset optional key is not. */
export function toBulkMarkBody(input: BulkMarkInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, BULK_MARK_BODY_FIELDS, (value) => value !== undefined, body);
  body.entries = input.entries.map((entry) => {
    const row: Record<string, unknown> = {};
    copyMappedFields(entry, BULK_MARK_ENTRY_FIELDS, (value) => value !== undefined, row);
    return row;
  });
  return body;
}

function isUnmarkableReason(value: unknown): value is UnmarkableReason {
  return UNMARKABLE_REASONS.includes(value as UnmarkableReason);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Whether a register or a correction may set `status` (every status but `on_leave`). */
export function isMarkableStatus(status: string): status is MarkableStatus {
  return (MARKABLE_STATUSES as readonly string[]).includes(status);
}

/** A `meta.attendance_mode`; anything but `period` reads as the daily default. */
export function toAttendanceMode(value: unknown): AttendanceMode {
  return value === PERIOD_ATTENDANCE_MODE ? PERIOD_ATTENDANCE_MODE : DEFAULT_ATTENDANCE_MODE;
}

/** The register's `meta` as the screen reads it. A missing or unknown value falls to the
 * read-only side (`markable: false`), so a malformed answer never offers an edit. */
export function toRegisterMeta(meta: Record<string, unknown> | undefined): RegisterMeta {
  const raw = meta ?? {};
  return {
    attendanceMode: toAttendanceMode(raw.attendance_mode),
    isLocked: raw.is_locked === true,
    markable: raw.markable === true,
    unmarkableReason: isUnmarkableReason(raw.unmarkable_reason) ? raw.unmarkable_reason : null,
    holidayName: stringOrNull(raw.holiday_name),
    academicSessionId: stringOrNull(raw.academic_session_id),
  };
}

/** `:bulk-mark`'s `meta` (`marked`, `updated`, `alerts_queued`); a missing count is 0. */
export function toBulkMarkMeta(meta: Record<string, unknown> | undefined): BulkMarkMeta {
  const raw = meta ?? {};
  const count = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    marked: count(raw.marked),
    updated: count(raw.updated),
    alertsQueued: count(raw.alerts_queued),
  };
}

function isRowIssue(value: unknown): value is RowIssue {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.student_id === "string" && typeof row.issue === "string";
}

/**
 * A refused `:bulk-mark`'s per-student issues (student id -> the server's sentence), from
 * `error.meta.rows` (never `details`, which the server flattens). Empty for any other error.
 * When a student is listed twice the first issue wins.
 */
export function rowIssuesFromError(error: unknown): Map<string, string> {
  const issues = new Map<string, string>();
  if (!(error instanceof ApiError)) return issues;
  const rows = error.meta.rows;
  if (!Array.isArray(rows)) return issues;
  for (const row of rows) {
    if (isRowIssue(row) && !issues.has(row.student_id)) issues.set(row.student_id, row.issue);
  }
  return issues;
}

/**
 * A serializer error on one submitted row. DRF's `ListField` reports child errors as a dict keyed
 * by index, which `core.api.exceptions._flatten_details` turns into `entries.<index>.<field>`; the
 * list form `entries[<index>].<field>` is accepted too.
 */
const ENTRY_FIELD = /^entries(?:\.(\d+)|\[(\d+)\])\./;

/**
 * A refused `:bulk-mark`'s per-row field errors (for example "A student cannot leave before they
 * arrived." on `entries.2.check_out_time`), keyed by the student sent at that index. Empty for
 * any other error.
 */
export function entryIssuesFromError(
  error: unknown,
  sentStudentIds: readonly string[],
): Map<string, string> {
  const issues = new Map<string, string>();
  if (!(error instanceof ApiError)) return issues;
  for (const detail of error.details) {
    const match = detail.field?.match(ENTRY_FIELD);
    const index = match?.[1] ?? match?.[2];
    const studentId = index === undefined ? undefined : sentStudentIds[Number(index)];
    if (studentId !== undefined && !issues.has(studentId)) issues.set(studentId, detail.issue);
  }
  return issues;
}

/** A register with each student's record replaced by the one a submission just wrote. */
export function withSavedRecords(
  register: RegisterResult,
  records: readonly StudentAttendanceRecord[],
): RegisterResult {
  const saved = new Map(records.map((record) => [record.student_id, record]));
  return {
    ...register,
    entries: register.entries.map((entry) => {
      const record = saved.get(entry.student_id);
      return record ? { ...entry, record } : entry;
    }),
  };
}
