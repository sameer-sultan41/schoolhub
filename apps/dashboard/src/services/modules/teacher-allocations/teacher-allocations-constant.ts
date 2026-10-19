import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  AllocateTeacherInput,
  AllocationRowAction,
  TeacherAllocationPageQuery,
  UpdateAllocationInput,
} from "./teacher-allocations-type";

/** The teacher-allocations module's constants. */

/** The query-key module every allocation read lives under: invalidating it refreshes the
 * list, the load panel and the dashboard's teacher-load widget together. */
export const ALLOCATION_QUERY_MODULE = "teacher-allocations";
export const ALLOCATION_LIST_RESOURCE = "allocations";
export const ALLOCATION_LOAD_SUMMARY_RESOURCE = "load-summary";

/** Column id -> the `?ordering=` field the allocations list accepts. */
export const ALLOCATION_SORT_FIELD: Record<string, string> = {
  section: "section_name",
  subject: "subject_name",
  teacher: "staff_last_name",
  weeklyPeriods: "weekly_periods",
  effectiveFrom: "effective_from",
  role: "is_primary",
};

/** Column ids the list may be sorted by: the `sort` values the URL is allowed to carry. */
export const ALLOCATION_SORTABLE_IDS = Object.keys(ALLOCATION_SORT_FIELD);

/** Sorted by section, so a section's subjects sit together. */
export const ALLOCATION_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "section", desc: false },
];

/** The id of the table's `actions` column: hidden for a locked session, never by the viewer. */
export const ALLOCATION_ACTIONS_COLUMN_ID = "actions";

/** The `session` URL key. `""` is the current session. Also the toolbar's read of it. */
export const ALLOCATION_SESSION_PARAM = "session";

/** The row actions, named once: the columns raise one, the table opens its dialog. */
export const ALLOCATION_ROW_ACTION = {
  edit: "edit",
  end: "end",
  reinstate: "reinstate",
  remove: "remove",
} as const satisfies Record<AllocationRowAction, AllocationRowAction>;

/** The state filter's values: `current` and `ended` map to the API's `current` flag, `all`
 * omits it. */
export const ALLOCATION_STATE = {
  current: "current",
  ended: "ended",
  all: FILTER_ALL,
} as const;

const ALLOCATION_STATE_VALUES: readonly string[] = Object.values(ALLOCATION_STATE);

/** The list's URL filters (`useDataGridUrlState`): URL key -> default and validator. Every id
 * must be a UUID, so a hand-edited value is never sent to the API. */
export const ALLOCATION_URL_FILTERS = {
  [ALLOCATION_SESSION_PARAM]: { default: "", isValid: isUuid },
  class: { default: "", isValid: isUuid },
  section: { default: "", isValid: isUuid },
  subject: { default: "", isValid: isUuid },
  teacher: { default: "", isValid: isUuid },
  state: {
    default: ALLOCATION_STATE.current,
    isValid: (value: string) => ALLOCATION_STATE_VALUES.includes(value),
  },
};

/** The fewest periods a week an allocation's override can be (academics.md §11). */
export const ALLOCATION_MIN_WEEKLY_PERIODS = 1;

/** The model's own default for `is_primary`: a new allocation is the primary teacher. */
export const ALLOCATION_DEFAULT_IS_PRIMARY = true;

/** The fields a server error may name on each form, so it shows under its own input. Any other
 * field's error shows as the form's own message (`foldUnknownFieldErrors`): an edit leaves out
 * the identity fields, which it shows read-only. */
export const ALLOCATION_CREATE_ERROR_FIELDS = [
  "section_id",
  "subject_id",
  "staff_id",
  "is_primary",
  "weekly_periods",
  "effective_from",
] as const;
export const ALLOCATION_EDIT_ERROR_FIELDS = [
  "is_primary",
  "weekly_periods",
  "effective_from",
] as const;

/** camelCase `AllocateTeacherInput` key -> the API's snake_case body key. Drives
 * `toAllocationCreateBody`. No `effective_to`: a create is never sent one (the server refuses a
 * date there; only PATCH sets it). */
export const ALLOCATION_CREATE_BODY_FIELDS: ReadonlyArray<
  readonly [keyof AllocateTeacherInput, string]
> = [
  ["academicSessionId", "academic_session_id"],
  ["sectionId", "section_id"],
  ["subjectId", "subject_id"],
  ["staffId", "staff_id"],
  ["isPrimary", "is_primary"],
  ["weeklyPeriods", "weekly_periods"],
  ["effectiveFrom", "effective_from"],
];

/** camelCase `UpdateAllocationInput` key -> the API's snake_case body key. Drives
 * `toAllocationUpdateBody`. Session, section, subject and teacher identify an allocation, so
 * an edit never sends them. */
export const ALLOCATION_UPDATE_BODY_FIELDS: ReadonlyArray<
  readonly [keyof UpdateAllocationInput, string]
> = [
  ["isPrimary", "is_primary"],
  ["weeklyPeriods", "weekly_periods"],
  ["effectiveFrom", "effective_from"],
  ["effectiveTo", "effective_to"],
];

/** camelCase `TeacherAllocationPageQuery` key -> the list endpoint's query param. Drives
 * `toAllocationQueryParams`. */
export const ALLOCATION_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof TeacherAllocationPageQuery, string]
> = [
  ["page", "page"],
  ["pageSize", "page_size"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["academicSessionId", "academic_session_id"],
  ["classId", "class_id"],
  ["sectionId", "section_id"],
  ["subjectId", "subject_id"],
  ["staffId", "staff_id"],
  ["current", "current"],
];
