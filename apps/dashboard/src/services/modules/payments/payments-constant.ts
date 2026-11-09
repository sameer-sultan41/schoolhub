import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type {
  CounterPaymentMethod,
  PaymentMethod,
  PaymentsQuery,
  PaymentStatus,
} from "./payments-type";

/** The payments module's constants. */

/** The query-key module every payment read lives under; a write invalidates it. */
export const PAYMENTS_QUERY_MODULE = "payments";
export const PAYMENTS_LIST_RESOURCE = "list";
/** One invoice's payments, which the invoice page shows read-only. */
export const PAYMENTS_BY_INVOICE_RESOURCE = "by-invoice";
/** Rows read for one invoice: an invoice has a handful of payments, so one page is its whole list. */
export const PAYMENTS_BY_INVOICE_PAGE_SIZE = 100;

/** The counter's methods, keyed so the compiler checks the set against the generated enum (L32). */
const COUNTER_METHODS_SET: Record<CounterPaymentMethod, true> = {
  cash: true,
  cheque: true,
  bank_transfer: true,
  card: true,
};
export const COUNTER_PAYMENT_METHODS = Object.keys(COUNTER_METHODS_SET) as CounterPaymentMethod[];
export const DEFAULT_COUNTER_METHOD: CounterPaymentMethod = "cash";

/** Methods whose payment the server refuses without a reference (`RecordPaymentSerializer.validate`). */
export const METHODS_NEEDING_REFERENCE: readonly CounterPaymentMethod[] = [
  "cheque",
  "bank_transfer",
];
export const PAYMENT_REFERENCE_MAX = 80;
/** The body fields a `:record` refusal can name; each has an input in the dialog. */
export const RECORD_PAYMENT_ERROR_FIELDS = ["amount", "method", "reference_no"] as const;

/** camelCase `PaymentsQuery` key -> the list's query param. */
export const PAYMENTS_QUERY_FIELDS: ReadonlyArray<readonly [keyof PaymentsQuery, string]> = [
  ["invoiceId", "invoice"],
  ["studentId", "student"],
  ["method", "method"],
  ["status", "status"],
  ["paidAtGte", "paid_at__gte"],
  ["paidAtLte", "paid_at__lte"],
  ["receivedBy", "received_by"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** Rows per page on the Payments tab: the cursor list has no page-size picker. */
export const PAYMENTS_PAGE_SIZE = 25;

/** Every method and status, keyed so the compiler checks the set against the generated enum (L32). */
const PAYMENT_METHODS_SET: Record<PaymentMethod, true> = {
  cash: true,
  cheque: true,
  bank_transfer: true,
  card: true,
  online_gateway: true,
};
export const PAYMENT_METHODS = Object.keys(PAYMENT_METHODS_SET) as PaymentMethod[];
const PAYMENT_STATUSES_SET: Record<PaymentStatus, true> = {
  pending: true,
  confirmed: true,
  failed: true,
  reversed: true,
};
export const PAYMENT_STATUSES = Object.keys(PAYMENT_STATUSES_SET) as PaymentStatus[];

/** Column id -> the `?ordering=` field `/payments` accepts. */
export const PAYMENTS_SORT_FIELD: Record<string, string> = {
  paid_at: "paid_at",
  amount: "amount",
};
export const PAYMENTS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "paid_at", desc: true },
];

/**
 * The cashier filter's URL value for "my collections": the viewer's own id is resolved at read
 * time, so a shared link means "the person who opens it". Any other value is a cashier's user
 * id (a link from a report), validated as one.
 */
export const CASHIER_FILTER_ME = "me";
/** `YYYY-MM-DD`, what `<input type="date">` holds. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isDateOrBlank = (value: string) => value === "" || DATE_PATTERN.test(value);
const isCashier = (value: string) => value === "" || value === CASHIER_FILTER_ME || isUuid(value);
const METHOD_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...PAYMENT_METHODS];
const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...PAYMENT_STATUSES];

/** The Payments tab's URL filters (`useDataGridUrlState`): `from`/`to` bound `paid_at` by day. */
export const PAYMENTS_URL_FILTERS = {
  method: { default: FILTER_ALL, isValid: (value: string) => METHOD_FILTER_VALUES.includes(value) },
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  from: { default: "", isValid: isDateOrBlank },
  to: { default: "", isValid: isDateOrBlank },
  cashier: { default: "", isValid: isCashier },
};

/** The first and last moment of a day, as the API's date-time filters take them. */
export const DAY_START_TIME = "T00:00:00";
export const DAY_END_TIME = "T23:59:59";
