import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type { FineInput, FinesQuery, FineStatus, FineType } from "./fines-type";

/** The fines module's constants. */

/** The query-key module every fine read lives under; a write invalidates it. */
export const FINES_QUERY_MODULE = "fines";
export const FINES_LIST_RESOURCE = "list";

/** Every status and type, keyed so the compiler checks the set against the generated enum (L32). */
const FINE_STATUSES_SET: Record<FineStatus, true> = {
  pending: true,
  invoiced: true,
  paid: true,
  waived: true,
};
export const FINE_STATUSES = Object.keys(FINE_STATUSES_SET) as FineStatus[];
const FINE_TYPES_SET: Record<FineType, true> = {
  late_fee: true,
  library: true,
  transport: true,
  damage: true,
  discipline: true,
  other: true,
};
export const FINE_TYPES = Object.keys(FINE_TYPES_SET) as FineType[];
export const DEFAULT_FINE_TYPE: FineType = "late_fee";
/** Only a pending fine can be waived: once invoiced the charge is on a document a parent holds. */
export const FINE_STATUS_WAIVABLE: FineStatus = "pending";
/** A fine's fee head must be in this category (the server refuses any other under `fee_head`). */
export const FINE_HEAD_CATEGORY = "fine";

/** camelCase `FineInput` key -> the API's body key. */
export const FINES_BODY_FIELDS: ReadonlyArray<readonly [keyof FineInput, string]> = [
  ["studentId", "student"],
  ["feeHeadId", "fee_head"],
  ["fineType", "fine_type"],
  ["amount", "amount"],
  ["reason", "reason"],
];

/** camelCase `FinesQuery` key -> the list's query param. */
export const FINES_QUERY_FIELDS: ReadonlyArray<readonly [keyof FinesQuery, string]> = [
  ["studentId", "student"],
  ["feeHeadId", "fee_head_id"],
  ["fineType", "fine_type"],
  ["status", "status"],
  ["sourceModule", "source_module"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

export const FINE_REASON_MAX = 2000;
/** Rows per page: the cursor list has no page-size picker. */
export const FINES_PAGE_SIZE = 25;

/** Column id -> the `?ordering=` field `/fines` accepts. */
export const FINES_SORT_FIELD: Record<string, string> = {
  created_at: "created_at",
  amount: "amount",
};
export const FINES_SORTABLE_IDS = Object.keys(FINES_SORT_FIELD);
export const FINES_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "created_at", desc: true },
];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...FINE_STATUSES];
const isIdOrBlank = (value: string) => value === "" || isUuid(value);

/** The fines list's URL filters (`useDataGridUrlState`); `student` is set by a link. */
export const FINES_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  student: { default: "", isValid: isIdOrBlank },
};

/** The create form's fields that have an input: a server error on any other folds into the form's message. */
export const FINE_ERROR_FIELDS = ["student", "fee_head", "fine_type", "amount", "reason"] as const;
/** The waive dialog's inputs: the server's `reason` and `status` (not pending) refusals both show in it. */
export const FINE_WAIVE_ERROR_FIELDS = ["reason", "status"] as const;
