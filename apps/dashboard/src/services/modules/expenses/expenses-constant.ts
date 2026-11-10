import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  ExpenseInput,
  ExpensePaymentMethod,
  ExpensesQuery,
  ExpenseStatus,
} from "./expenses-type";

/** The expenses module's constants. */

export const EXPENSES_QUERY_MODULE = "expenses";
export const EXPENSES_LIST_RESOURCE = "list";
export const EXPENSES_PAGE_SIZE = 25;

export const EXPENSE_VENDOR_MAX = 160;
export const EXPENSE_REASON_MAX = 2000;

/** Every status, keyed so the compiler checks the set against the generated enum (L32). */
const EXPENSE_STATUSES_SET: Record<ExpenseStatus, true> = {
  draft: true,
  submitted: true,
  approved: true,
  paid: true,
  rejected: true,
  reversed: true,
};
export const EXPENSE_STATUSES = Object.keys(EXPENSE_STATUSES_SET) as ExpenseStatus[];

/** The statuses each action works from. */
export const EXPENSE_STATUS_EDITABLE: ExpenseStatus = "draft";
export const EXPENSE_STATUS_SUBMITTABLE: ExpenseStatus = "draft";
export const EXPENSE_STATUS_DECIDABLE: ExpenseStatus = "submitted";
export const EXPENSE_STATUS_PAYABLE: ExpenseStatus = "approved";
export const EXPENSE_STATUSES_REVERSIBLE: readonly ExpenseStatus[] = ["approved", "paid"];

/** The payment methods an expense takes: the generated enum minus the fee gateway (`online_gateway`). */
const EXPENSE_METHODS_SET: Record<ExpensePaymentMethod, true> = {
  cash: true,
  cheque: true,
  bank_transfer: true,
  card: true,
};
export const EXPENSE_PAYMENT_METHODS = Object.keys(EXPENSE_METHODS_SET) as ExpensePaymentMethod[];

/** camelCase `ExpenseInput` key -> the API's body key. */
export const EXPENSES_BODY_FIELDS: ReadonlyArray<readonly [keyof ExpenseInput, string]> = [
  ["expenseCategoryId", "expense_category"],
  ["campusId", "campus"],
  ["vendorName", "vendor_name"],
  ["description", "description"],
  ["amount", "amount"],
  ["taxAmount", "tax_amount"],
  ["expenseDate", "expense_date"],
  ["paymentMethod", "payment_method"],
];

/** camelCase `ExpensesQuery` key -> the list's query param. */
export const EXPENSES_QUERY_FIELDS: ReadonlyArray<readonly [keyof ExpensesQuery, string]> = [
  ["expenseCategoryId", "expense_category_id"],
  ["campusId", "campus_id"],
  ["status", "status"],
  ["dateFrom", "expense_date__gte"],
  ["dateTo", "expense_date__lte"],
  ["awaitingApproval", "awaiting_approval"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** Column id -> the `?ordering=` field `/expenses` accepts. */
export const EXPENSES_SORT_FIELD: Record<string, string> = {
  expense_date: "expense_date",
  amount: "amount",
};
export const EXPENSES_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "expense_date", desc: true },
];

/** The "Awaiting approval" toggle's URL value when on. */
export const AWAITING_APPROVAL_ON = "true";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isDateOrBlank = (value: string) => value === "" || DATE_PATTERN.test(value);
const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...EXPENSE_STATUSES];
/** A category or campus id read from the URL: anything that is not a UUID is ignored, not sent to the API as a 400. */
const isUuidOrBlank = (value: string) => value === "" || isUuid(value);

/** The Expenses tab's URL filters (`useDataGridUrlState`). `category` and `campus` are ids, kept only when they are UUIDs. */
export const EXPENSES_URL_FILTERS = {
  category: { default: "", isValid: isUuidOrBlank },
  campus: { default: "", isValid: isUuidOrBlank },
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  from: { default: "", isValid: isDateOrBlank },
  to: { default: "", isValid: isDateOrBlank },
  awaiting: {
    default: "",
    isValid: (value: string) => value === "" || value === AWAITING_APPROVAL_ON,
  },
};
export const EXPENSES_URL_FILTER_KEYS = Object.keys(EXPENSES_URL_FILTERS);

/** The create/edit form's fields that have an input: a server error on any other (`status`) folds into the form's message. */
export const EXPENSE_ERROR_FIELDS = [
  "expense_category",
  "campus",
  "vendor_name",
  "description",
  "amount",
  "tax_amount",
  "expense_date",
  "payment_method",
] as const;
export const EXPENSE_REASON_ERROR_FIELDS = ["reason"] as const;
/** The pickers' empty choice for an optional select. */
export const NO_OPTION = "none";

export type ExpenseDecision = "approve" | "reject";
