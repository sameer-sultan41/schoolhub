import { FILTER_ALL } from "@/lib/constants";
import { isIsoDate, isUuid } from "@/lib/helpers";
import type {
  AttendancePageQuery,
  AttendanceStatus,
  BulkMarkEntryInput,
  BulkMarkInput,
  MarkableStatus,
  UnmarkableReason,
} from "./student-attendance-type";

/** The student-attendance module's constants. */

/** The query-key module every register and record read lives under; a submit invalidates it. */
export const STUDENT_ATTENDANCE_QUERY_MODULE = "student-attendance";
export const REGISTER_RESOURCE = "register";
export const MY_REGISTERS_RESOURCE = "my-registers";
export const ATTENDANCE_LIST_RESOURCE = "list";

/** The register screen's URL keys: which register is open (`date` defaults to today). */
export const REGISTER_URL_KEYS = {
  date: "date",
  class: "class",
  section: "section",
  period: "period",
} as const;

/** Whether a register may submit each status, keyed so the compiler checks it against the
 * generated enum. `on_leave` is written by an approved leave request, never at the register. */
const MARKABLE_BY_STATUS: Record<AttendanceStatus, boolean> = {
  present: true,
  absent: true,
  late: true,
  half_day: true,
  excused: true,
  on_leave: false,
};
export const ATTENDANCE_STATUSES = Object.keys(MARKABLE_BY_STATUS) as AttendanceStatus[];
export const MARKABLE_STATUSES = ATTENDANCE_STATUSES.filter(
  (status) => MARKABLE_BY_STATUS[status],
) as MarkableStatus[];

/** `StudentAttendance.remarks`' `max_length`. */
export const ATTENDANCE_REMARKS_MAX_LENGTH = 255;

/** The `meta.unmarkable_reason` values (`services.UNMARKABLE_*`). */
export const UNMARKABLE_REASONS: readonly UnmarkableReason[] = [
  "future",
  "holiday",
  "non_working_day",
  "session_closed",
];

/** Rows per Records page: the API's cursor list has no page-size picker here. */
export const RECORDS_PAGE_SIZE = 25;

/** The Records list opens on this many calendar days, today included. */
export const RECORDS_DEFAULT_RANGE_DAYS = 7;

/** The date column's id: the one sortable column. */
export const RECORDS_DATE_COLUMN_ID = "date";

/** Column id -> the `?ordering=` field `/student-attendance` accepts (`ordering_fields`). */
export const RECORDS_SORT_FIELD: Record<string, string> = {
  [RECORDS_DATE_COLUMN_ID]: "attendance_date",
};
export const RECORDS_SORTABLE_IDS = Object.keys(RECORDS_SORT_FIELD);

/** Newest day first. */
export const RECORDS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: RECORDS_DATE_COLUMN_ID, desc: true },
];

export const RECORDS_ACTIONS_COLUMN_ID = "actions";

/** The locked filter's choices besides "all": rows past the lock window, or still editable. */
export const LOCK_FILTER_LOCKED = "locked";
export const LOCK_FILTER_OPEN = "open";
export const RECORDS_LOCK_FILTERS = [LOCK_FILTER_LOCKED, LOCK_FILTER_OPEN] as const;

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...ATTENDANCE_STATUSES];
const LOCK_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...RECORDS_LOCK_FILTERS];
const isDateOrEmpty = (value: string) => value === "" || isIsoDate(value);
const isUuidOrEmpty = (value: string) => value === "" || isUuid(value);

/**
 * The Records list's URL filters (`useDataGridUrlState`). A blank date is the default window
 * (`RECORDS_DEFAULT_RANGE_DAYS`, which moves with today, so it can't be a fixed default here).
 * `class` filters by the section's class; `section` narrows it, and only applies with a class
 * (the Section picker lists one class's sections).
 */
export const RECORDS_URL_FILTERS = {
  from: { default: "", isValid: isDateOrEmpty },
  to: { default: "", isValid: isDateOrEmpty },
  class: { default: "", isValid: isUuidOrEmpty },
  section: { default: "", isValid: isUuidOrEmpty },
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  locked: { default: FILTER_ALL, isValid: (value: string) => LOCK_FILTER_VALUES.includes(value) },
};

/** camelCase `AttendancePageQuery` key -> the list's query param. */
export const ATTENDANCE_QUERY_FIELDS: ReadonlyArray<readonly [keyof AttendancePageQuery, string]> =
  [
    ["cursor", "cursor"],
    ["search", "search"],
    ["ordering", "ordering"],
    ["status", "status"],
    ["date", "date"],
    ["dateFrom", "date__gte"],
    ["dateTo", "date__lte"],
    ["classId", "class_id"],
    ["sectionId", "section_id"],
    ["studentId", "student_id"],
    ["periodId", "period_id"],
    ["academicSessionId", "academic_session_id"],
    ["isLocked", "is_locked"],
  ];

/** camelCase `BulkMarkInput` key -> the `:bulk-mark` body key; `entries` is built apart. */
export const BULK_MARK_BODY_FIELDS: ReadonlyArray<
  readonly [Exclude<keyof BulkMarkInput, "entries">, string]
> = [
  ["sectionId", "section_id"],
  ["attendanceDate", "attendance_date"],
  ["periodId", "period_id"],
  ["academicSessionId", "academic_session_id"],
];

/** camelCase `BulkMarkEntryInput` key -> the entry's body key. */
export const BULK_MARK_ENTRY_FIELDS: ReadonlyArray<readonly [keyof BulkMarkEntryInput, string]> = [
  ["studentId", "student_id"],
  ["status", "status"],
  ["checkInTime", "check_in_time"],
  ["checkOutTime", "check_out_time"],
  ["remarks", "remarks"],
];

/** Mirror `REQUIRED_IMPORT_COLUMNS`/`IMPORT_COLUMNS` (`apps/api/apps/attendance/services.py`)
 * verbatim: the import template's exact header names. */
export const ATTENDANCE_IMPORT_REQUIRED_COLUMNS = [
  "admission_number",
  "attendance_date",
  "status",
] as const;
export const ATTENDANCE_IMPORT_OPTIONAL_COLUMNS = [
  "check_in_time",
  "check_out_time",
  "remarks",
] as const;

/** Per user as well as per tab: a different sign-in never reconnects to someone else's import. */
export const ATTENDANCE_IMPORT_JOB_STORAGE_PREFIX = "schoolhub:attendance-import-job:";
