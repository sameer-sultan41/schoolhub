import { FILTER_ALL } from "@/lib/constants";
import type { ExpenseCategoriesQuery, ExpenseCategoryInput } from "./expense-categories-type";

/** The expense-categories module's constants. */

/** The query-key module every expense-category read lives under; a write invalidates it. */
export const EXPENSE_CATEGORIES_QUERY_MODULE = "expense-categories";
export const EXPENSE_CATEGORIES_LIST_RESOURCE = "list";
export const EXPENSE_CATEGORIES_OPTIONS_RESOURCE = "options";

export const EXPENSE_CATEGORY_NAME_MAX = 120;
export const EXPENSE_CATEGORY_CODE_MAX = 30;
/** Rows per page: the cursor list has no page-size picker. */
export const EXPENSE_CATEGORIES_PAGE_SIZE = 25;

/** camelCase `ExpenseCategoryInput` key -> the API's body key. */
export const EXPENSE_CATEGORIES_BODY_FIELDS: ReadonlyArray<
  readonly [keyof ExpenseCategoryInput, string]
> = [
  ["name", "name"],
  ["code", "code"],
  ["ledgerAccountId", "ledger_account"],
  ["isActive", "is_active"],
];

/** camelCase `ExpenseCategoriesQuery` key -> the list's query param. */
export const EXPENSE_CATEGORIES_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof ExpenseCategoriesQuery, string]
> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["isActive", "is_active"],
  ["ledgerAccountId", "ledger_account_id"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** Column id -> the `?ordering=` field `/expense-categories` accepts. */
export const EXPENSE_CATEGORIES_SORT_FIELD: Record<string, string> = { code: "code", name: "name" };
export const EXPENSE_CATEGORIES_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "code", desc: false },
];

/** The `active` URL filter's values (besides `all`). */
export const EXPENSE_CATEGORY_ACTIVE_FILTERS = ["active", "inactive"] as const;
const ACTIVE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...EXPENSE_CATEGORY_ACTIVE_FILTERS];
/** The Categories tab's URL filters (`useDataGridUrlState`). */
export const EXPENSE_CATEGORIES_URL_FILTERS = {
  active: { default: FILTER_ALL, isValid: (value: string) => ACTIVE_FILTER_VALUES.includes(value) },
};

/** The form's fields that have an input: a server error on any other folds into the form's message. */
export const EXPENSE_CATEGORY_ERROR_FIELDS = [
  "name",
  "code",
  "ledger_account",
  "is_active",
] as const;
