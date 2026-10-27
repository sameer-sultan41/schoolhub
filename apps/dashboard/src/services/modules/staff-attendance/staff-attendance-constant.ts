import { FILTER_ALL } from "@/lib/constants";
import { isIsoDate } from "@/lib/helpers";
import type {
  MarkableStaffStatus,
  MarkStaffAttendanceInput,
  StaffAttendancePageQuery,
  StaffAttendanceStatus,
} from "./staff-attendance-type";

/** The staff-attendance module's constants. */

/** The query-key module every staff register and history read lives under. */
export const STAFF_ATTENDANCE_QUERY_MODULE = "staff-attendance";
export const STAFF_REGISTER_RESOURCE = "register";
export const STAFF_ATTENDANCE_LIST_RESOURCE = "list";

/** The Staff screen's own URL keys; the history's filters are `STAFF_HISTORY_URL_FILTERS`. */
export const STAFF_URL_KEYS = {
  view: "view",
  date: "date",
} as const;

/** The two views a marker switches between; a viewer without the mark key has only history. */
export const STAFF_VIEW_REGISTER = "register";
export const STAFF_VIEW_HISTORY = "history";
export type StaffView = typeof STAFF_VIEW_REGISTER | typeof STAFF_VIEW_HISTORY;

/** Whether the staff register may set each status, keyed so the compiler checks it against the
 * generated enum (`mark_staff_attendance` refuses `on_leave`; `holiday` is no one's mark). */
const MARKABLE_BY_STAFF_STATUS: Record<StaffAttendanceStatus, boolean> = {
  present: true,
  absent: true,
  late: true,
  half_day: true,
  on_leave: false,
  holiday: false,
};
export const STAFF_ATTENDANCE_STATUSES = Object.keys(
  MARKABLE_BY_STAFF_STATUS,
) as StaffAttendanceStatus[];
export const MARKABLE_STAFF_STATUSES = STAFF_ATTENDANCE_STATUSES.filter(
  (status) => MARKABLE_BY_STAFF_STATUS[status],
) as MarkableStaffStatus[];

/** The status a check-in means nothing for: an absent day sends no times. */
export const STAFF_STATUS_ABSENT: MarkableStaffStatus = "absent";

/** `StaffAttendance.remarks`' `max_length`. */
export const STAFF_REMARKS_MAX_LENGTH = 255;

/** Rows per history page: the API's cursor list has no page-size picker here. */
export const STAFF_HISTORY_PAGE_SIZE = 25;

/** The history opens on this many calendar days, today included. */
export const STAFF_HISTORY_DEFAULT_RANGE_DAYS = 30;

/** The date column's id: the one sortable column. */
export const STAFF_HISTORY_DATE_COLUMN_ID = "date";

/** Column id -> the `?ordering=` field `/staff-attendance` accepts (`ordering_fields`). */
export const STAFF_HISTORY_SORT_FIELD: Record<string, string> = {
  [STAFF_HISTORY_DATE_COLUMN_ID]: "attendance_date",
};
export const STAFF_HISTORY_SORTABLE_IDS = Object.keys(STAFF_HISTORY_SORT_FIELD);

/** Newest day first. */
export const STAFF_HISTORY_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: STAFF_HISTORY_DATE_COLUMN_ID, desc: true },
];

export const STAFF_HISTORY_ACTIONS_COLUMN_ID = "actions";

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...STAFF_ATTENDANCE_STATUSES];
const isDateOrEmpty = (value: string) => value === "" || isIsoDate(value);

/** The history's URL filters (`useDataGridUrlState`). A blank date is the default window
 * (`STAFF_HISTORY_DEFAULT_RANGE_DAYS`, which moves with today). */
export const STAFF_HISTORY_URL_FILTERS = {
  from: { default: "", isValid: isDateOrEmpty },
  to: { default: "", isValid: isDateOrEmpty },
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
};

/** camelCase `StaffAttendancePageQuery` key -> the list's query param
 * (`StaffAttendanceFilterSet`). */
export const STAFF_ATTENDANCE_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof StaffAttendancePageQuery, string]
> = [
  ["cursor", "cursor"],
  ["ordering", "ordering"],
  ["status", "status"],
  ["dateFrom", "date__gte"],
  ["dateTo", "date__lte"],
  ["staffId", "staff_id"],
];

/** camelCase `MarkStaffAttendanceInput` key -> the `POST /staff-attendance` body key. */
export const MARK_STAFF_BODY_FIELDS: ReadonlyArray<
  readonly [keyof MarkStaffAttendanceInput, string]
> = [
  ["staffId", "staff_id"],
  ["attendanceDate", "attendance_date"],
  ["status", "status"],
  ["checkInTime", "check_in_time"],
  ["checkOutTime", "check_out_time"],
  ["remarks", "remarks"],
];

/** The check-out dialog's one input: a server error on any other field is its own message. */
export const CHECK_OUT_ERROR_FIELDS = ["check_out_time"] as const;
