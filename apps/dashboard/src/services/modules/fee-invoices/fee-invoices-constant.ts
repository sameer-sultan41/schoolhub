import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  FeeInvoiceStatus,
  FeeInvoicesQuery,
  GenerateInvoicesInput,
} from "./fee-invoices-type";

/** The fee-invoices module's constants. */

/** The query-key module every invoice read lives under; a write invalidates it. */
export const FEE_INVOICES_QUERY_MODULE = "fee-invoices";
export const FEE_INVOICES_LIST_RESOURCE = "list";
export const FEE_INVOICES_DETAIL_RESOURCE = "detail";
/** One student's outstanding invoices on the fee counter. */
export const FEE_INVOICES_COUNTER_RESOURCE = "counter-outstanding";
/** Rows read for the counter: a student has a handful owing, so one page is the whole list. */
export const FEE_INVOICES_COUNTER_PAGE_SIZE = 100;
/** Namespaces the generation job's poll (`useJobPolling`). */
export const FEE_INVOICES_JOB_MODULE = "fee-invoices-generate";

/** Every invoice status, keyed so the compiler checks the set against the generated enum (L32). */
const FEE_INVOICE_STATUSES_SET: Record<FeeInvoiceStatus, true> = {
  draft: true,
  issued: true,
  partially_paid: true,
  paid: true,
  overdue: true,
  canceled: true,
};
export const FEE_INVOICE_STATUSES = Object.keys(FEE_INVOICE_STATUSES_SET) as FeeInvoiceStatus[];
export const FEE_INVOICE_STATUS_CANCELED: FeeInvoiceStatus = "canceled";

/** camelCase `FeeInvoicesQuery` key -> the list's query param. */
export const FEE_INVOICES_QUERY_FIELDS: ReadonlyArray<readonly [keyof FeeInvoicesQuery, string]> = [
  ["studentId", "student"],
  ["academicSessionId", "academic_session_id"],
  ["feeStructureId", "fee_structure_id"],
  ["status", "status"],
  ["periodLabel", "period_label"],
  ["dueDateGte", "due_date__gte"],
  ["dueDateLte", "due_date__lte"],
  ["outstanding", "outstanding"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** camelCase `GenerateInvoicesInput` key -> the API's body key. */
export const FEE_INVOICES_GENERATE_FIELDS: ReadonlyArray<
  readonly [keyof GenerateInvoicesInput, string]
> = [
  ["feeStructureId", "fee_structure"],
  ["periodStart", "period_start"],
  ["termId", "term"],
];

export const FEE_INVOICE_REASON_MAX = 2000;
/** Rows per page: the cursor list has no page-size picker. */
export const FEE_INVOICES_PAGE_SIZE = 25;
export const FEE_INVOICES_ACTIONS_COLUMN_ID = "actions";

/** Column id -> the `?ordering=` field `/fee-invoices` accepts. */
export const FEE_INVOICES_SORT_FIELD: Record<string, string> = {
  issue_date: "issue_date",
  due_date: "due_date",
  balance_due: "balance_due",
};
export const FEE_INVOICES_SORTABLE_IDS = Object.keys(FEE_INVOICES_SORT_FIELD);
export const FEE_INVOICES_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "issue_date", desc: true },
];

/** The defaulters toggle's URL value: `?outstanding=true` is on, anything else off. */
export const OUTSTANDING_ON = "true";
export const OUTSTANDING_OFF = "";

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...FEE_INVOICE_STATUSES];
const isIdOrBlank = (value: string) => value === "" || isUuid(value);

/** The invoices list's URL filters (`useDataGridUrlState`): an id filter is `""` for all. */
export const FEE_INVOICES_URL_FILTERS = {
  session: { default: "", isValid: isIdOrBlank },
  structure: { default: "", isValid: isIdOrBlank },
  student: { default: "", isValid: isIdOrBlank },
  status: {
    default: FILTER_ALL,
    isValid: (value: string) => STATUS_FILTER_VALUES.includes(value),
  },
  outstanding: {
    default: OUTSTANDING_OFF,
    isValid: (value: string) => value === OUTSTANDING_ON,
  },
};

export const FEE_INVOICE_GENERATE_ERROR_FIELDS = ["fee_structure", "period_start", "term"] as const;
export const FEE_INVOICE_CANCEL_ERROR_FIELDS = ["reason"] as const;
