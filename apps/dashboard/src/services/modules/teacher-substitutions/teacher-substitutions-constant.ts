import { FILTER_ALL } from "@/lib/constants";
import { isIsoDate } from "@/lib/helpers";
import type {
  ProposeSubstitutionInput,
  SubstitutionPageQuery,
  SubstitutionStatus,
} from "./teacher-substitutions-type";

/** The teacher-substitutions module's constants. */

/** The query-key module every cover read lives under; a cover write invalidates it. */
export const SUBSTITUTIONS_QUERY_MODULE = "teacher-substitutions";
export const SUBSTITUTIONS_LIST_RESOURCE = "list";
export const SUBSTITUTION_CANDIDATES_RESOURCE = "candidates";

/** Every status, keyed so the compiler checks the set against the generated enum. */
const STATUS_SET: Record<SubstitutionStatus, true> = {
  proposed: true,
  confirmed: true,
  declined: true,
  completed: true,
  cancelled: true,
};
export const SUBSTITUTION_STATUSES = Object.keys(STATUS_SET) as SubstitutionStatus[];

/** Cover that still holds its slot and teacher: what `:cancel` may release. */
export const OPEN_SUBSTITUTION_STATUSES: readonly SubstitutionStatus[] = ["proposed", "confirmed"];

/** Column id -> the `?ordering=` field `/teacher-substitutions` accepts. */
export const SUBSTITUTIONS_SORT_FIELD: Record<string, string> = {
  date: "date",
  status: "status",
  absent: "absent_staff_last_name",
  substitute: "substitute_staff_last_name",
};
export const SUBSTITUTIONS_SORTABLE_IDS = Object.keys(SUBSTITUTIONS_SORT_FIELD);

/** Newest cover first (the API's own default). */
export const SUBSTITUTIONS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "date", desc: true },
];

export const SUBSTITUTIONS_ACTIONS_COLUMN_ID = "actions";

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...SUBSTITUTION_STATUSES];
const isDateOrEmpty = (value: string) => value === "" || isIsoDate(value);

/** The list's URL filters (`useDataGridUrlState`). */
export const SUBSTITUTIONS_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  from: { default: "", isValid: isDateOrEmpty },
  to: { default: "", isValid: isDateOrEmpty },
};

/** The room select's stand-in for "keep the timetabled room" (a `SelectItem` can't be `""`). */
export const SUBSTITUTION_KEEP_ROOM = FILTER_ALL;

/** Longest reason (`timetable.models.TeacherSubstitution.reason`). */
export const SUBSTITUTION_REASON_MAX = 200;

/** camelCase `ProposeSubstitutionInput` key -> the API body key. */
export const SUBSTITUTION_BODY_FIELDS: ReadonlyArray<
  readonly [keyof ProposeSubstitutionInput, string]
> = [
  ["timetableSlotId", "timetable_slot_id"],
  ["date", "date"],
  ["absentStaffId", "absent_staff_id"],
  ["substituteStaffId", "substitute_staff_id"],
  ["roomId", "room_id"],
  ["reason", "reason"],
];

/** camelCase `SubstitutionPageQuery` key -> the list's query param. */
export const SUBSTITUTION_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof SubstitutionPageQuery, string]
> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["status", "status"],
  ["dateFrom", "date__gte"],
  ["dateTo", "date__lte"],
];

/** Fields a server error may name in the propose form; any other is the form's message. */
export const SUBSTITUTION_ERROR_FIELDS = [
  "date",
  "absent_staff_id",
  "timetable_slot_id",
  "substitute_staff_id",
  "room_id",
  "reason",
] as const;
