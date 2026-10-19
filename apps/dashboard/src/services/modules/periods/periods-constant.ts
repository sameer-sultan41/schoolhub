import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type { PeriodInput, PeriodPageQuery } from "./periods-type";

/** The periods module's constants. */

/** The query-key module every period read lives under; a period write invalidates it. */
export const PERIODS_QUERY_MODULE = "periods";
export const PERIODS_LIST_RESOURCE = "list";

/** Column id -> the `?ordering=` field `/periods` accepts. */
export const PERIODS_SORT_FIELD: Record<string, string> = {
  sequence: "sequence",
  name: "name",
  time: "start_time",
  kind: "is_break",
  campus: "campus_name",
};

export const PERIODS_SORTABLE_IDS = Object.keys(PERIODS_SORT_FIELD);

/** The day's order, as the bell rings. */
export const PERIODS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "sequence", desc: false },
];

/** The kind filter: `all` omits the API filter, the others map to `is_break`. */
export const PERIOD_KIND = { all: FILTER_ALL, teaching: "teaching", break: "break" } as const;

const PERIOD_KIND_VALUES: readonly string[] = Object.values(PERIOD_KIND);

/** The table's `actions` column id: hidden for a viewer with neither action. */
export const PERIODS_ACTIONS_COLUMN_ID = "actions";

/** The list's URL filters (`useDataGridUrlState`). */
export const PERIODS_URL_FILTERS = {
  campus: { default: "", isValid: isUuid },
  kind: {
    default: PERIOD_KIND.all,
    isValid: (value: string) => PERIOD_KIND_VALUES.includes(value),
  },
};

/** The weekday numbers a period can run on, Monday (0) to Sunday (6), in display order. */
export const PERIOD_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** The first period of a day is 1 (`timetable.models.Period.sequence`). */
export const PERIOD_MIN_SEQUENCE = 1;

/** Longest `name` (`timetable.models.Period.name`). */
export const PERIOD_NAME_MAX = 50;

/** `HH:MM` — what a time input gives and what the form holds; the API's `HH:MM:SS` is cut to
 * it on load. */
export const PERIOD_TIME_LENGTH = 5;

/** The form select's stand-in for an empty `campus_id` (a `Select` item can't be `""`). */
export const PERIOD_ALL_CAMPUSES = FILTER_ALL;

/** camelCase `PeriodInput` key -> the API's body key. */
export const PERIODS_BODY_FIELDS: ReadonlyArray<readonly [keyof PeriodInput, string]> = [
  ["campusId", "campus_id"],
  ["name", "name"],
  ["sequence", "sequence"],
  ["startTime", "start_time"],
  ["endTime", "end_time"],
  ["isBreak", "is_break"],
  ["weekdays", "weekdays"],
];

/** camelCase `PeriodPageQuery` key -> the `/periods` query param. */
export const PERIODS_QUERY_FIELDS: ReadonlyArray<readonly [keyof PeriodPageQuery, string]> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["forCampusId", "for_campus"],
  ["isBreak", "is_break"],
];

/** The fields a server error may name on the form; any other shows as the form's message. */
export const PERIODS_ERROR_FIELDS = [
  "campus_id",
  "name",
  "sequence",
  "start_time",
  "end_time",
  "is_break",
  "weekdays",
] as const;
