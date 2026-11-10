import type { QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import { FILTER_ALL } from "@/lib/constants";
import {
  CASHIER_FILTER_ME,
  DEFAULT_COUNTER_METHOD,
  METHODS_NEEDING_REFERENCE,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENTS_QUERY_FIELDS,
} from "./payments-constant";
import type { RecordPaymentFormValues } from "./payments.schema";
import type {
  CounterPaymentMethod,
  PaymentMethod,
  PaymentsQuery,
  PaymentStatus,
  RecordPaymentInput,
} from "./payments-type";

/** The payments module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toPaymentsQueryParams(query: PaymentsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    PAYMENTS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** `:record`'s body: the reference only when one was given (cash needs none). */
export function toRecordPaymentBody(input: RecordPaymentInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    fee_invoice: input.feeInvoiceId,
    amount: input.amount,
    method: input.method,
  };
  if (input.referenceNo) body.reference_no = input.referenceNo;
  return body;
}

/** Whether the server will want a reference for this method. */
export function needsReference(method: CounterPaymentMethod): boolean {
  return METHODS_NEEDING_REFERENCE.includes(method);
}

/** The form's starting values: the whole balance, in cash. `balanceDue` is the server's string. */
export function defaultRecordPaymentFormValues(balanceDue: string): RecordPaymentFormValues {
  return { amount: balanceDue, method: DEFAULT_COUNTER_METHOD, reference_no: "" };
}

export function buildRecordPaymentInput(
  feeInvoiceId: string,
  values: RecordPaymentFormValues,
): RecordPaymentInput {
  return {
    feeInvoiceId,
    amount: values.amount.trim(),
    method: values.method,
    referenceNo: values.reference_no.trim() || null,
  };
}

export function paymentMethodFilter(value: string): PaymentMethod | undefined {
  return value === FILTER_ALL ? undefined : PAYMENT_METHODS.find((method) => method === value);
}

export function paymentStatusFilter(value: string): PaymentStatus | undefined {
  return value === FILTER_ALL ? undefined : PAYMENT_STATUSES.find((status) => status === value);
}

/** The instant a `YYYY-MM-DD` day (plus `addDays`) starts at, as an offset-aware ISO string. */
function localMidnight(day: string, addDays = 0): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Number(year), Number(month) - 1, Number(date) + addDays).toISOString();
}

/**
 * A day-bounded `paid_at` filter: `from` is that day's first instant, `to` is the start of the
 * day after it, sent as an exclusive bound (`paid_at__lt`). A naive `YYYY-MM-DDT00:00:00` would
 * be read by the server as a UTC day, so the bounds are offset-aware instants. They are the
 * viewer's local midnights (`new Date(y, m, d)`): the dashboard does not hold the tenant's
 * timezone for a finance role (`/tenant` is not read here), so a viewer far from the school sees
 * the school's days shifted by the difference.
 */
export function paidAtBounds(
  from: string,
  to: string,
): Pick<PaymentsQuery, "paidAtGte" | "paidAtLt"> {
  return {
    paidAtGte: from ? localMidnight(from) : undefined,
    paidAtLt: to ? localMidnight(to, 1) : undefined,
  };
}

/** The cashier filter's user id: `"me"` is the viewer's own; `undefined` while that is unknown or no filter is set. */
export function cashierFilterId(
  value: string,
  currentUserId: string | undefined,
): string | undefined {
  if (value === "") return undefined;
  return value === CASHIER_FILTER_ME ? currentUserId : value;
}
