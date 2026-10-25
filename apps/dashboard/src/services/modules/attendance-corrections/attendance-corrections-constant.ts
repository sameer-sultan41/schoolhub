import { FILTER_ALL } from "@/lib/constants";
import type {
  CorrectionNewValues,
  CorrectionPageQuery,
  CorrectionStatus,
} from "./attendance-corrections-type";

/** The attendance-corrections module's constants. */

/** The query-key module every corrections read lives under; a request or a decision
 * invalidates it. */
export const CORRECTIONS_QUERY_MODULE = "attendance-corrections";
export const CORRECTIONS_LIST_RESOURCE = "list";

/** Rows per corrections page: the API's cursor list has no page-size picker here. */
export const CORRECTIONS_PAGE_SIZE = 25;

/** Newest request first (`ordering_fields` is `created_at`, `status`). */
export const CORRECTIONS_ORDERING = "-created_at";

/** `CorrectionDecisionSerializer.review_note`'s `max_length`. */
export const CORRECTION_REVIEW_NOTE_MAX_LENGTH = 500;

export const CORRECTION_STATUS_PENDING: CorrectionStatus = "pending";

/** Every status, keyed so the compiler checks the set against the generated enum. */
const STATUS_SET: Record<CorrectionStatus, true> = {
  pending: true,
  approved: true,
  rejected: true,
  cancelled: true,
};
export const CORRECTION_STATUSES = Object.keys(STATUS_SET) as CorrectionStatus[];

/** The Mine filter's one value besides "off" (a blank): the caller's own requests. */
export const CORRECTIONS_MINE = "true";

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...CORRECTION_STATUSES];

/** The queue's URL filters (`useDataGridUrlState`): the approver's work, pending, by default. */
export const CORRECTIONS_URL_FILTERS = {
  status: {
    default: CORRECTION_STATUS_PENDING,
    isValid: (value: string) => STATUS_FILTER_VALUES.includes(value),
  },
  mine: { default: "", isValid: (value: string) => value === "" || value === CORRECTIONS_MINE },
};

/** The corrections list has no sortable column; the sort is fixed (`CORRECTIONS_ORDERING`). */
export const CORRECTIONS_SORTABLE_IDS: readonly string[] = [];
export const CORRECTIONS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [];
export const CORRECTIONS_ACTIONS_COLUMN_ID = "actions";

/** camelCase `CorrectionPageQuery` key -> the list's query param; the page size goes first. */
export const CORRECTION_QUERY_FIELDS: ReadonlyArray<readonly [keyof CorrectionPageQuery, string]> =
  [
    ["cursor", "cursor"],
    ["ordering", "ordering"],
    ["status", "status"],
    ["mine", "mine"],
  ];

/** The fields a correction may change, in the diff's display order (`CORRECTABLE_FIELDS`). */
export const CORRECTION_CHANGE_FIELDS: readonly (keyof CorrectionNewValues)[] = [
  "status",
  "check_in_time",
  "check_out_time",
  "remarks",
];

/** The decision dialog's one input: a server error on any other field is its own message. */
export const CORRECTION_DECISION_ERROR_FIELDS = ["review_note"] as const;

/** `AttendanceCorrection.reason`'s `max_length`. */
export const CORRECTION_REASON_MAX_LENGTH = 500;

/**
 * The fields a server error may name in the request dialog: the serializer's `new_values`
 * checks arrive flattened as `new_values.<field>`. Any other field, `new_values` itself (the
 * "values match the record" and `on_leave` refusals) included, is the dialog's own message.
 */
export const CORRECTION_ERROR_FIELDS = [
  "new_values.status",
  "new_values.check_in_time",
  "new_values.check_out_time",
  "new_values.remarks",
  "reason",
] as const;
