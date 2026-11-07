import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  FeeStructureStatus,
  FeeStructureInput,
  FeeStructuresQuery,
} from "./fee-structures-type";

/** The fee-structures module's constants. */

/** The query-key module every feeStructure read lives under; a write invalidates it. */
export const FEE_STRUCTURES_QUERY_MODULE = "fee-structures";
export const FEE_STRUCTURES_LIST_RESOURCE = "list";
export const FEE_STRUCTURES_DETAIL_RESOURCE = "detail";

/** Every FeeStructureStatus value, keyed so the compiler checks the set against the generated enum (L32). */
const FEE_STRUCTURE_STATUSES_SET: Record<FeeStructureStatus, true> = {
  draft: true,
  active: true,
  archived: true,
};
export const FEE_STRUCTURE_STATUSES = Object.keys(
  FEE_STRUCTURE_STATUSES_SET,
) as FeeStructureStatus[];

/** camelCase `FeeStructureInput` key -> the API's body key. */
export const FEE_STRUCTURES_BODY_FIELDS: ReadonlyArray<readonly [keyof FeeStructureInput, string]> =
  [
    ["name", "name"],
    ["academicSessionId", "academic_session"],
    ["classId", "school_class"],
    ["campusId", "campus"],
  ];

/** camelCase `FeeStructuresQuery` key -> the list's query param. */
export const FEE_STRUCTURES_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof FeeStructuresQuery, string]
> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["academicSessionId", "academic_session_id"],
  ["classId", "class_id"],
  ["campusId", "campus_id"],
  ["status", "status"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

export const FEE_STRUCTURE_NAME_MAX = 120;
/** Rows per page: the cursor list has no page-size picker. */
export const FEE_STRUCTURES_PAGE_SIZE = 25;
export const FEE_STRUCTURES_ACTIONS_COLUMN_ID = "actions";

/** Column id -> the `?ordering=` field `/fee-structures` accepts. */
export const FEE_STRUCTURES_SORT_FIELD: Record<string, string> = { name: "name" };
export const FEE_STRUCTURES_SORTABLE_IDS = Object.keys(FEE_STRUCTURES_SORT_FIELD);
export const FEE_STRUCTURES_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "name", desc: false },
];

const FEE_STRUCTURE_STATUS_FILTER_VALUES: readonly string[] = [
  FILTER_ALL,
  ...FEE_STRUCTURE_STATUSES,
];
const isIdOrBlank = (value: string) => value === "" || isUuid(value);

/** The structures list's URL filters (`useDataGridUrlState`): an id filter is `""` for all. */
export const FEE_STRUCTURES_URL_FILTERS = {
  session: { default: "", isValid: isIdOrBlank },
  class: { default: "", isValid: isIdOrBlank },
  campus: { default: "", isValid: isIdOrBlank },
  status: {
    default: FILTER_ALL,
    isValid: (value: string) => FEE_STRUCTURE_STATUS_FILTER_VALUES.includes(value),
  },
};

/** The form's fields that have an input: a server error on any other folds into the form's message. */
export const FEE_STRUCTURE_ERROR_FIELDS = [
  "name",
  "academic_session",
  "school_class",
  "campus",
] as const;

/** The page's `?tab=` key and the structures page's two tabs. */
export const FEES_TAB_URL_KEY = "tab";
export const STRUCTURES_TAB_ID = "structures";
export const HEADS_TAB_ID = "heads";
