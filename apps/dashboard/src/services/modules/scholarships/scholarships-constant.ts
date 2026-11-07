import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  ScholarshipCoverage,
  ScholarshipInput,
  ScholarshipsQuery,
  ScholarshipStatus,
  ScholarshipType,
} from "./scholarships-type";

/** The scholarships module's constants. */

/** The query-key module every scholarship read lives under; a write invalidates it. */
export const SCHOLARSHIPS_QUERY_MODULE = "scholarships";
export const SCHOLARSHIPS_LIST_RESOURCE = "list";

/** Every status, type and coverage, keyed so the compiler checks the set against the generated enum (L32). */
const SCHOLARSHIP_STATUSES_SET: Record<ScholarshipStatus, true> = {
  applied: true,
  approved: true,
  active: true,
  ended: true,
  revoked: true,
};
export const SCHOLARSHIP_STATUSES = Object.keys(SCHOLARSHIP_STATUSES_SET) as ScholarshipStatus[];
const SCHOLARSHIP_TYPES_SET: Record<ScholarshipType, true> = {
  merit: true,
  need: true,
  sports: true,
  staff_ward: true,
  other: true,
};
export const SCHOLARSHIP_TYPES = Object.keys(SCHOLARSHIP_TYPES_SET) as ScholarshipType[];
const SCHOLARSHIP_COVERAGES_SET: Record<ScholarshipCoverage, true> = { percent: true, fixed: true };
export const SCHOLARSHIP_COVERAGES = Object.keys(
  SCHOLARSHIP_COVERAGES_SET,
) as ScholarshipCoverage[];
export const DEFAULT_SCHOLARSHIP_TYPE: ScholarshipType = "merit";
export const DEFAULT_SCHOLARSHIP_COVERAGE: ScholarshipCoverage = "percent";

/**
 * The lifecycle the server enforces (`SCHOLARSHIP_TRANSITIONS`, 422 on `status`): status -> the
 * statuses it may move to. `ended` and `revoked` are final. The UI offers only these.
 */
export const SCHOLARSHIP_NEXT_STATES: Record<ScholarshipStatus, readonly ScholarshipStatus[]> = {
  applied: ["approved", "revoked"],
  approved: ["active", "revoked"],
  active: ["ended", "revoked"],
  ended: [],
  revoked: [],
};
/** Ending or revoking an award needs `notes` (the server refuses without them). */
export const SCHOLARSHIP_NOTES_REQUIRED: readonly ScholarshipStatus[] = ["ended", "revoked"];
/** What a new award may start as: awaiting a decision, or already approved. */
export const SCHOLARSHIP_INITIAL_STATUSES: readonly ScholarshipStatus[] = ["applied", "approved"];
export const DEFAULT_SCHOLARSHIP_INITIAL_STATUS: ScholarshipStatus = "applied";

/** camelCase `ScholarshipInput` key -> the API's body key. */
export const SCHOLARSHIPS_BODY_FIELDS: ReadonlyArray<readonly [keyof ScholarshipInput, string]> = [
  ["studentId", "student"],
  ["academicSessionId", "academic_session"],
  ["name", "name"],
  ["scholarshipType", "scholarship_type"],
  ["coverageType", "coverage_type"],
  ["value", "value"],
  ["sponsor", "sponsor"],
  ["status", "status"],
  ["notes", "notes"],
];

/** camelCase `ScholarshipsQuery` key -> the list's query param. */
export const SCHOLARSHIPS_QUERY_FIELDS: ReadonlyArray<readonly [keyof ScholarshipsQuery, string]> =
  [
    ["studentId", "student"],
    ["academicSessionId", "academic_session_id"],
    ["scholarshipType", "scholarship_type"],
    ["status", "status"],
    ["sponsor", "sponsor"],
    ["search", "search"],
    ["ordering", "ordering"],
    ["cursor", "cursor"],
    ["pageSize", "page_size"],
  ];

export const SCHOLARSHIP_NAME_MAX = 120;
export const SCHOLARSHIP_SPONSOR_MAX = 120;
export const SCHOLARSHIP_NOTES_MAX = 2000;
/** Rows per page: the cursor list has no page-size picker. */
export const SCHOLARSHIPS_PAGE_SIZE = 25;

/** Column id -> the `?ordering=` field `/scholarships` accepts. */
export const SCHOLARSHIPS_SORT_FIELD: Record<string, string> = {
  created_at: "created_at",
  value: "value",
};
export const SCHOLARSHIPS_SORTABLE_IDS = Object.keys(SCHOLARSHIPS_SORT_FIELD);
export const SCHOLARSHIPS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "created_at", desc: true },
];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...SCHOLARSHIP_STATUSES];
const isIdOrBlank = (value: string) => value === "" || isUuid(value);

/** The scholarships list's URL filters (`useDataGridUrlState`); `student` is set by a link. */
export const SCHOLARSHIPS_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  student: { default: "", isValid: isIdOrBlank },
};

/** The create form's fields that have an input: a server error on any other folds into the form's message. */
export const SCHOLARSHIP_ERROR_FIELDS = [
  "student",
  "academic_session",
  "name",
  "scholarship_type",
  "coverage_type",
  "value",
  "sponsor",
  "status",
  "notes",
] as const;
/** The status dialog's inputs: the server's `status` (an illegal move) and `notes` refusals both show in it. */
export const SCHOLARSHIP_STATUS_ERROR_FIELDS = ["status", "notes"] as const;
