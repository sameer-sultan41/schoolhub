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
