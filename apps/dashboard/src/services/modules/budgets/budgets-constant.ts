import { FILTER_ALL } from "@/lib/constants";
import type { BudgetInput, BudgetsQuery, BudgetStatus } from "./budgets-type";

/** The budgets module's constants. */

export const BUDGETS_QUERY_MODULE = "budgets";
export const BUDGETS_LIST_RESOURCE = "list";
export const BUDGETS_PAGE_SIZE = 25;

export const BUDGET_NAME_MAX = 160;

/** Every status, keyed so the compiler checks the set against the generated enum (L32). */
const BUDGET_STATUSES_SET: Record<BudgetStatus, true> = {
  draft: true,
  approved: true,
  closed: true,
};
export const BUDGET_STATUSES = Object.keys(BUDGET_STATUSES_SET) as BudgetStatus[];

/** Approve and edit work only from a draft. */
export const BUDGET_STATUS_DRAFT: BudgetStatus = "draft";

/** A budget targets one of these. */
export const BUDGET_TARGETS = ["category", "account"] as const;
export type BudgetTarget = (typeof BUDGET_TARGETS)[number];

/** camelCase `BudgetInput` key -> the API's body key. */
export const BUDGETS_BODY_FIELDS: ReadonlyArray<readonly [keyof BudgetInput, string]> = [
  ["name", "name"],
  ["ledgerAccountId", "ledger_account"],
  ["expenseCategoryId", "expense_category"],
  ["campusId", "campus"],
  ["periodStart", "period_start"],
  ["periodEnd", "period_end"],
  ["amount", "amount"],
  ["notes", "notes"],
];

/** camelCase `BudgetsQuery` key -> the list's query param. */
export const BUDGETS_QUERY_FIELDS: ReadonlyArray<readonly [keyof BudgetsQuery, string]> = [
  ["status", "status"],
  ["campusId", "campus_id"],
  ["expenseCategoryId", "expense_category_id"],
  ["ledgerAccountId", "ledger_account_id"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

export const BUDGETS_SORT_FIELD: Record<string, string> = {
  period_start: "period_start",
  amount: "amount",
};
export const BUDGETS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "period_start", desc: true },
];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...BUDGET_STATUSES];
/** The Budgets tab's URL filters (`useDataGridUrlState`). */
export const BUDGETS_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
};
export const BUDGETS_URL_FILTER_KEYS = Object.keys(BUDGETS_URL_FILTERS);

/**
 * The form's fields that have an input. The server's "name exactly one" refusal arrives with no
 * field, so it folds into the form's message.
 */
export const BUDGET_ERROR_FIELDS = [
  "name",
  "ledger_account",
  "expense_category",
  "campus",
  "period_start",
  "period_end",
  "amount",
  "notes",
] as const;
