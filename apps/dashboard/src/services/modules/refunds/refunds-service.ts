import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import {
  toProcessRefundBody,
  toRefundDecisionBody,
  toRefundsQueryParams,
  toRequestRefundBody,
} from "./refunds-helper";
import type {
  ProcessRefundInput,
  RefundDecisionInput,
  RefundRecord,
  RefundsQuery,
  RequestRefundInput,
} from "./refunds-type";

/** The refunds API calls (`/refunds`, `fees.payment.view`), reached through `Services.refunds.*`. */

export async function listRefunds(query: RefundsQuery = {}): Promise<Page<RefundRecord>> {
  return fetchPage<RefundRecord>(apiClient, endpoints.refunds.list, {
    query: toRefundsQueryParams(query),
  });
}

/**
 * Asks for money back against a payment (`POST /refunds:create`, `fees.payment.refund`). The
 * `Idempotency-Key` is required: a double submit or a retry after a lost response replays the
 * first request instead of filing it twice. Over what is still refundable is a 422 under `amount`
 * with `meta.refundable_remainder`.
 */
export async function createRefund(
  input: RequestRefundInput,
  idempotencyKey: string,
): Promise<RefundRecord> {
  const { data } = await apiClient.post<RefundRecord>(
    endpoints.refunds.create,
    toRequestRefundBody(input),
    { idempotencyKey },
  );
  return data;
}

/** Approves a requested refund (`fees.refund.approve`). The requester approving their own is a 422. */
export async function approveRefund(
  id: string,
  input: RefundDecisionInput = {},
): Promise<RefundRecord> {
  const { data } = await apiClient.post<RefundRecord>(
    endpoints.refunds.approve(id),
    toRefundDecisionBody(input),
  );
  return data;
}

export async function rejectRefund(
  id: string,
  input: RefundDecisionInput = {},
): Promise<RefundRecord> {
  const { data } = await apiClient.post<RefundRecord>(
    endpoints.refunds.reject(id),
    toRefundDecisionBody(input),
  );
  return data;
}

/**
 * Pays an approved refund out and reverses its ledger posting (`POST /refunds/{id}:process`,
 * `fees.refund.approve`). It posts to the ledger, so it carries an `Idempotency-Key`: a double
 * submit or a retry replays the first answer instead of paying twice.
 */
export async function processRefund(
  id: string,
  input: ProcessRefundInput,
  idempotencyKey: string,
): Promise<RefundRecord> {
  const { data } = await apiClient.post<RefundRecord>(
    endpoints.refunds.process(id),
    toProcessRefundBody(input),
    { idempotencyKey },
  );
  return data;
}
