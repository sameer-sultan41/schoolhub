import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toPaymentsQueryParams, toRecordPaymentBody } from "./payments-helper";
import type { PaymentRecord, PaymentsQuery, RecordPaymentInput } from "./payments-type";

/** The payments API calls (`/payments`, `fees.payment.view`), reached through `Services.payments.*`. */

export async function listPayments(query: PaymentsQuery = {}): Promise<Page<PaymentRecord>> {
  return fetchPage<PaymentRecord>(apiClient, endpoints.payments.list, {
    query: toPaymentsQueryParams(query),
  });
}

/**
 * Takes money against an invoice (`POST /payments:record`, `fees.payment.collect`). The
 * `Idempotency-Key` is required: a double submit or a retry after a lost response replays the
 * first payment instead of taking the money twice. Over the balance is a 422 under `amount`.
 */
export async function recordPayment(
  input: RecordPaymentInput,
  idempotencyKey: string,
): Promise<PaymentRecord> {
  const { data } = await apiClient.post<PaymentRecord>(
    endpoints.payments.record,
    toRecordPaymentBody(input),
    { idempotencyKey },
  );
  return data;
}
