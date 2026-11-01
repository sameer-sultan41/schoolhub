import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type { ExamInput, ExamPageQuery, ExamStatus, ExamType } from "./exams-type";

/** The exams module's constants. */

/** The query-key module every exam read lives under; an exam or exam-subject write invalidates it. */
export const EXAMS_QUERY_MODULE = "exams";
export const EXAMS_LIST_RESOURCE = "list";
export const EXAMS_DETAIL_RESOURCE = "exam";

/**
 * Where each status sits in the lifecycle, typed over every generated status so a status the
 * API adds is a compile error here until it is placed. `ongoing` has a place but nothing sets
 * it (the stepper shows it skippable); `archived` is the terminal one.
 */
export const EXAM_STATUS_ORDER: Record<ExamStatus, number> = {
  draft: 0,
  scheduled: 1,
  ongoing: 2,
  marks_entry: 3,
  processing: 4,
  approved: 5,
  published: 6,
  archived: 7,
};
export const EXAM_STATUSES = (Object.keys(EXAM_STATUS_ORDER) as ExamStatus[]).sort(
  (a, b) => EXAM_STATUS_ORDER[a] - EXAM_STATUS_ORDER[b],
);

/** A status no action sets: the stepper draws the exam past it without calling it passed. */
export const SKIPPABLE_EXAM_STATUSES: readonly ExamStatus[] = ["ongoing"];
/** The last status: nothing follows it. */
export const TERMINAL_EXAM_STATUS: ExamStatus = "archived";

/** An exam is configured (edited, its subjects changed) up to and including `scheduled`
 * (`services.CONFIGURABLE_STATUSES`); past it, marks may exist against the structure. */
export const CONFIGURABLE_EXAM_STATUSES: readonly ExamStatus[] = ["draft", "scheduled"];
/** Only a draft exam is deleted (`services.assert_exam_is_deletable`). */
export const DELETABLE_EXAM_STATUS: ExamStatus = "draft";

const EXAM_TYPE_SET: Record<ExamType, true> = {
  unit_test: true,
  midterm: true,
  final: true,
  practical: true,
  custom: true,
};
export const EXAM_TYPES = Object.keys(EXAM_TYPE_SET) as ExamType[];

/** A new exam is a midterm until said otherwise. */
export const DEFAULT_EXAM_TYPE: ExamType = "midterm";
/** The column's default: the whole of a consolidated result. */
export const DEFAULT_WEIGHTAGE_PERCENT = "100";

/** Column id -> the `?ordering=` field `/exams` accepts. */
export const EXAMS_SORT_FIELD: Record<string, string> = { name: "name", dates: "starts_on" };
export const EXAMS_SORTABLE_IDS = Object.keys(EXAMS_SORT_FIELD);
export const EXAMS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [{ id: "dates", desc: true }];

/** The table's `actions` column id: hidden for a viewer with no write key. */
export const EXAMS_ACTIONS_COLUMN_ID = "actions";

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...EXAM_STATUSES];
const TYPE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...EXAM_TYPES];
const isAllOrUuid = (value: string) => value === FILTER_ALL || isUuid(value);

/** The list's URL filters (`useDataGridUrlState`). Session and term are ids, or `all`. */
export const EXAMS_URL_FILTERS = {
  session: { default: FILTER_ALL, isValid: isAllOrUuid },
  term: { default: FILTER_ALL, isValid: isAllOrUuid },
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  type: { default: FILTER_ALL, isValid: (value: string) => TYPE_FILTER_VALUES.includes(value) },
};

/** The column limits (`examinations.models`). */
export const EXAM_NAME_MAX = 150;
export const EXAM_DESCRIPTION_MAX = 500;
/** `weightage_percent`: above 0, at most 100, two decimals. */
export const WEIGHTAGE_PATTERN = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

/** camelCase `ExamInput` key -> the API's body key. */
export const EXAMS_BODY_FIELDS: ReadonlyArray<readonly [keyof ExamInput, string]> = [
  ["name", "name"],
  ["academicSessionId", "academic_session_id"],
  ["termId", "term_id"],
  ["examType", "exam_type"],
  ["gradingScaleId", "grading_scale_id"],
  ["weightagePercent", "weightage_percent"],
  ["startsOn", "starts_on"],
  ["endsOn", "ends_on"],
  ["description", "description"],
];

/** camelCase `ExamPageQuery` key -> the `/exams` query param. */
export const EXAMS_QUERY_FIELDS: ReadonlyArray<readonly [keyof ExamPageQuery, string]> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["academicSessionId", "academic_session_id"],
  ["termId", "term_id"],
  ["status", "status"],
  ["examType", "exam_type"],
];

/** The fields a server error may name on the exam form; any other shows as the form's message. */
export const EXAM_ERROR_FIELDS = [
  "name",
  "academic_session_id",
  "term_id",
  "exam_type",
  "grading_scale_id",
  "weightage_percent",
  "starts_on",
  "ends_on",
  "description",
] as const;
