import { FILTER_ALL } from "@/lib/constants";
import { isIsoDate, isUuid } from "@/lib/helpers";
import type { LeaveDayPart, LeavePageQuery, LeaveStatus } from "./leave-requests-type";

/** The leave-requests module's constants. */

/** The query-key module every leave-request read lives under; a decision invalidates it. */
export const LEAVE_QUERY_MODULE = "leave-requests";
export const LEAVE_LIST_RESOURCE = "list";

/** The leave-type catalogue, apart from the requests: a decision does not change it. */
export const LEAVE_TYPES_QUERY_MODULE = "leave-types";
export const LEAVE_TYPES_LIST_RESOURCE = "list";

/** Rows per leave page: the API's cursor list has no page-size picker here. */
export const LEAVE_PAGE_SIZE = 25;

/** Newest request first (`ordering_fields` is `start_date`, `created_at`, `status`). */
export const LEAVE_ORDERING = "-created_at";

/** `LeaveDecisionSerializer.note`'s `max_length`. */
export const LEAVE_NOTE_MAX_LENGTH = 500;

export const LEAVE_STATUS_PENDING: LeaveStatus = "pending";

/** Every status, keyed so the compiler checks the set against the generated enum. */
const STATUS_SET: Record<LeaveStatus, true> = {
  pending: true,
  approved: true,
  rejected: true,
  cancelled: true,
};
export const LEAVE_STATUSES = Object.keys(STATUS_SET) as LeaveStatus[];

/** A request that names no day part (`day_part` is optional on the wire) is a full day. */
export const LEAVE_DEFAULT_DAY_PART: LeaveDayPart = "full";

/** A leave type that no student request can use (`AppliesTo.STAFF`) has no place in this queue. */
export const LEAVE_TYPE_STAFF_ONLY = "staff";

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...LEAVE_STATUSES];

/** The queue's URL filters (`useDataGridUrlState`): the approver's work, pending, by default. */
export const LEAVE_URL_FILTERS = {
  status: {
    default: LEAVE_STATUS_PENDING,
    isValid: (value: string) => STATUS_FILTER_VALUES.includes(value),
  },
  type: { default: "", isValid: (value: string) => value === "" || isUuid(value) },
  from: { default: "", isValid: (value: string) => value === "" || isIsoDate(value) },
  to: { default: "", isValid: (value: string) => value === "" || isIsoDate(value) },
};

/** The leave list has no sortable column; the sort is fixed (`LEAVE_ORDERING`). */
export const LEAVE_SORTABLE_IDS: readonly string[] = [];
export const LEAVE_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const LEAVE_ACTIONS_COLUMN_ID = "actions";

/** camelCase `LeavePageQuery` key -> the list's query param; the page size goes first. */
export const LEAVE_QUERY_FIELDS: ReadonlyArray<readonly [keyof LeavePageQuery, string]> = [
  ["cursor", "cursor"],
  ["ordering", "ordering"],
  ["status", "status"],
  ["leaveTypeId", "leave_type_id"],
  ["dateFrom", "date__gte"],
  ["dateTo", "date__lte"],
];

/** The server's own `meta` key for the days an approval marked. */
export const AUTO_MARKED_DAYS_KEY = "auto_marked_days";

/** `days_count` is a one-decimal figure (half days): show at most this many digits. */
export const LEAVE_DAYS_FRACTION_DIGITS = 1;

/** The key that decides a student leave step (`STUDENT_LEAVE_APPROVE`). */
export const LEAVE_APPROVE_PERMISSION = "attendance.leave-request.approve";

/** A chain step's `required_permission` -> its label under `leave.detail.chain.permission`. */
export const LEAVE_STEP_PERMISSION_LABELS: Readonly<Record<string, string>> = {
  [LEAVE_APPROVE_PERMISSION]: "leaveApprove",
};

/** The decision dialog's one input: a server error on any other field is its own message. */
export const LEAVE_DECISION_ERROR_FIELDS = ["note"] as const;
