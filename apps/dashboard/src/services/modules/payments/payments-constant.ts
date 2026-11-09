import type { CounterPaymentMethod, PaymentsQuery } from "./payments-type";

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
