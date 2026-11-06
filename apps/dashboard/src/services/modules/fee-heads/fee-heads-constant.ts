import { FILTER_ALL } from "@/lib/constants";
import type { FeeHeadCategory, FeeHeadInput, FeeHeadsQuery } from "./fee-heads-type";

/** The fee-heads module's constants. */

/** The query-key module every feeHead read lives under; a write invalidates it. */
export const FEE_HEADS_QUERY_MODULE = "fee-heads";
export const FEE_HEADS_LIST_RESOURCE = "list";
export const FEE_HEADS_DETAIL_RESOURCE = "detail";

/** Every FeeHeadCategory value, keyed so the compiler checks the set against the generated enum (L32). */
const FEE_HEAD_CATEGORIES_SET: Record<FeeHeadCategory, true> = {
  tuition: true,
  admission: true,
  transport: true,
  library: true,
  exam: true,
  fine: true,
  other: true,
};
export const FEE_HEAD_CATEGORIES = Object.keys(FEE_HEAD_CATEGORIES_SET) as FeeHeadCategory[];

/** camelCase `FeeHeadInput` key -> the API's body key. */
export const FEE_HEADS_BODY_FIELDS: ReadonlyArray<readonly [keyof FeeHeadInput, string]> = [
  ["name", "name"],
  ["code", "code"],
  ["category", "category"],
  ["ledgerAccountId", "ledger_account"],
  ["isRefundable", "is_refundable"],
  ["isActive", "is_active"],
];

/** camelCase `FeeHeadsQuery` key -> the list's query param. */
export const FEE_HEADS_QUERY_FIELDS: ReadonlyArray<readonly [keyof FeeHeadsQuery, string]> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["category", "category"],
  ["ledgerAccountId", "ledger_account_id"],
  ["isActive", "is_active"],
  ["isRefundable", "is_refundable"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

export const FEE_HEAD_CODE_MAX = 30;
export const FEE_HEAD_NAME_MAX = 120;
export const DEFAULT_FEE_HEAD_CATEGORY: FeeHeadCategory = "tuition";
/** Rows per page: the cursor list has no page-size picker. */
export const FEE_HEADS_PAGE_SIZE = 25;
export const FEE_HEADS_ACTIONS_COLUMN_ID = "actions";

/** Column id -> the `?ordering=` field `/fee-heads` accepts. */
export const FEE_HEADS_SORT_FIELD: Record<string, string> = { code: "code", name: "name" };
export const FEE_HEADS_SORTABLE_IDS = Object.keys(FEE_HEADS_SORT_FIELD);
export const FEE_HEADS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "code", desc: false },
];

export const FEE_HEAD_ACTIVE_FILTERS = ["active", "inactive"] as const;
const FEE_HEAD_CATEGORY_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...FEE_HEAD_CATEGORIES];
const FEE_HEAD_ACTIVE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...FEE_HEAD_ACTIVE_FILTERS];

/** The heads list's URL filters (`useDataGridUrlState`); the key `headCategory` and `headActive`
 * are distinct from the structures list's, which shares the page's query string. */
export const FEE_HEADS_URL_FILTERS = {
  headCategory: {
    default: FILTER_ALL,
    isValid: (value: string) => FEE_HEAD_CATEGORY_FILTER_VALUES.includes(value),
  },
  headActive: {
    default: FILTER_ALL,
    isValid: (value: string) => FEE_HEAD_ACTIVE_FILTER_VALUES.includes(value),
  },
};

/** The form's fields that have an input: a server error on any other folds into the form's message. */
export const FEE_HEAD_ERROR_FIELDS = [
  "name",
  "code",
  "category",
  "ledger_account",
  "is_refundable",
  "is_active",
] as const;

/** The query resource a picker's read of the heads lives under. */
export const FEE_HEADS_OPTIONS_RESOURCE = "options";
