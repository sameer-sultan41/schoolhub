import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type { CurriculumInput, CurriculumPageQuery } from "./curriculum-type";

/** The curriculum module's constants. */

/** The query-key module every curriculum read lives under: a curriculum write invalidates it,
 * which also refreshes the allocate form's subject picker. */
export const CURRICULUM_QUERY_MODULE = "curriculum";
export const CURRICULUM_LIST_RESOURCE = "class-subjects";
export const CURRICULUM_FOR_CLASS_RESOURCE = "for-class";

/** Column id -> the `?ordering=` field the `/class-subjects` list accepts. */
export const CURRICULUM_SORT_FIELD: Record<string, string> = {
  class: "class_name",
  subject: "subject_name",
  campus: "campus_name",
  weeklyPeriods: "weekly_periods",
  kind: "is_elective",
};

/** Column ids the list may be sorted by: the `sort` values the URL is allowed to carry. */
export const CURRICULUM_SORTABLE_IDS = Object.keys(CURRICULUM_SORT_FIELD);

/** Sorted by class, so a class's subjects sit together. */
export const CURRICULUM_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "class", desc: false },
];

/** The kind filter's values: `all` omits the API filter, the others map to `is_elective`. */
export const CURRICULUM_KIND = { all: FILTER_ALL, core: "core", elective: "elective" } as const;

const CURRICULUM_KIND_VALUES: readonly string[] = Object.values(CURRICULUM_KIND);

/** The id of the table's `actions` column: hidden for a locked session, never by the viewer. */
export const CURRICULUM_ACTIONS_COLUMN_ID = "actions";

/** The `session` URL key. `""` is the current session. Also the toolbar's read of it. */
export const CURRICULUM_SESSION_PARAM = "session";

/** The list's URL filters (`useDataGridUrlState`): URL key -> default and validator. Every id
 * must be a UUID, so a hand-edited value is never sent to the API. */
export const CURRICULUM_URL_FILTERS = {
  [CURRICULUM_SESSION_PARAM]: { default: "", isValid: isUuid },
  class: { default: "", isValid: isUuid },
  campus: { default: "", isValid: isUuid },
  kind: {
    default: CURRICULUM_KIND.all,
    isValid: (value: string) => CURRICULUM_KIND_VALUES.includes(value),
  },
};

/** The fewest periods a week a subject can have (academics.md §11). */
export const CURRICULUM_MIN_WEEKLY_PERIODS = 1;

/** Longest `notes` and `elective_group` (`docs/05-database/entities/academics.md`). */
export const CURRICULUM_NOTES_MAX = 500;
export const CURRICULUM_ELECTIVE_GROUP_MAX = 50;

/** The form select's stand-in for an empty `campus_id` (a `Select` item can't be `""`). */
export const CURRICULUM_ALL_CAMPUSES = FILTER_ALL;

/** camelCase `CurriculumInput` key -> the API's snake_case body key. Drives
 * `toCurriculumBody` (`curriculum-helper.ts`). */
export const CURRICULUM_BODY_FIELDS: ReadonlyArray<readonly [keyof CurriculumInput, string]> = [
  ["academicSessionId", "academic_session_id"],
  ["classId", "class_id"],
  ["subjectId", "subject_id"],
  ["campusId", "campus_id"],
  ["isElective", "is_elective"],
  ["electiveGroup", "elective_group"],
  ["weeklyPeriods", "weekly_periods"],
  ["notes", "notes"],
];

/** camelCase `CurriculumPageQuery` key -> the `/class-subjects` list endpoint's query param.
 * Drives `toCurriculumQueryParams`; `page`/`page_size` aren't here since they're always seeded. */
export const CURRICULUM_QUERY_FIELDS: ReadonlyArray<readonly [keyof CurriculumPageQuery, string]> =
  [
    ["search", "search"],
    ["ordering", "ordering"],
    ["academicSessionId", "academic_session_id"],
    ["classId", "class_id"],
    ["campusId", "campus_id"],
    ["isElective", "is_elective"],
  ];

/** The form field the elective group is typed into; it is mounted only for an elective. */
export const CURRICULUM_ELECTIVE_GROUP_FIELD = "elective_group";

/** The fields a server error may name on the form, so each shows under its own input. An edit
 * leaves out the identity fields, which it shows read-only. Any other field's error shows as
 * the form's own message (`foldUnknownFieldErrors`). */
export const CURRICULUM_CREATE_ERROR_FIELDS = [
  "class_id",
  "subject_id",
  CURRICULUM_ELECTIVE_GROUP_FIELD,
  "weekly_periods",
  "notes",
] as const;
export const CURRICULUM_EDIT_ERROR_FIELDS = [
  CURRICULUM_ELECTIVE_GROUP_FIELD,
  "weekly_periods",
  "notes",
] as const;
