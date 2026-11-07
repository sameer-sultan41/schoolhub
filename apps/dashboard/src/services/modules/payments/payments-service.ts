import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toPaymentsQueryParams } from "./payments-helper";
import type { PaymentRecord, PaymentsQuery } from "./payments-type";

/** The payments API calls (`/payments`, `fees.payment.view`), reached through `Services.payments.*`. */

export async function listPayments(query: PaymentsQuery = {}): Promise<Page<PaymentRecord>> {
  return fetchPage<PaymentRecord>(apiClient, endpoints.payments.list, {
    query: toPaymentsQueryParams(query),
  });
}
