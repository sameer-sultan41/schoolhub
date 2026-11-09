import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  REFUNDABLE_REMAINDER_META_KEY,
  REFUND_STATUS_DECIDABLE,
  REFUND_STATUS_PROCESSABLE,
  REFUND_STATUSES,
  REFUNDS_QUERY_FIELDS,
} from "./refunds-constant";
import type {
  ProcessRefundInput,
  RefundDecisionInput,
  RefundRecord,
  RefundsQuery,
  RefundStatus,
  RequestRefundInput,
} from "./refunds-type";
import type {
  ProcessRefundFormValues,
  RefundDecisionFormValues,
  RequestRefundFormValues,
} from "./refunds.schema";

/** The refunds module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toRefundsQueryParams(query: RefundsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    REFUNDS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "" && value !== 0,
    params,
  );
  return params as QueryParams;
}

export function toRequestRefundBody(input: RequestRefundInput): Record<string, unknown> {
  return { payment: input.paymentId, amount: input.amount, reason: input.reason };
}

/** A decision's body: the note only when one was written. */
export function toRefundDecisionBody(input: RefundDecisionInput): Record<string, unknown> {
  return input.note ? { note: input.note } : {};
}

/** `:process`'s body: the reference only when one was given. */
export function toProcessRefundBody(input: ProcessRefundInput): Record<string, unknown> {
  const body: Record<string, unknown> = { method: input.method };
  if (input.referenceNo) body.reference_no = input.referenceNo;
  return body;
}

export function buildRequestRefundInput(
  paymentId: string,
  values: RequestRefundFormValues,
): RequestRefundInput {
  return { paymentId, amount: values.amount.trim(), reason: values.reason.trim() };
}

export function buildRefundDecisionInput(values: RefundDecisionFormValues): RefundDecisionInput {
  return { note: values.note.trim() || null };
}

export function buildProcessRefundInput(values: ProcessRefundFormValues): ProcessRefundInput {
  return { method: values.method, referenceNo: values.reference_no.trim() || null };
}

/** A status filter's URL value as the API's: `undefined` for "all" or a value that is not a status. */
export function refundStatusFilter(value: string): RefundStatus | undefined {
  return value === FILTER_ALL ? undefined : REFUND_STATUSES.find((status) => status === value);
}

/**
 * Whether Approve and Reject are offered to this viewer: only on a requested refund, and never to
 * the person who requested it (the server refuses that with a 422, segregation of duties; a
 * button that always fails for that person is not offered).
 */
export function canDecideRefund(
  refund: Pick<RefundRecord, "status" | "requested_by">,
  currentUserId: string | undefined,
): boolean {
  return (
    refund.status === REFUND_STATUS_DECIDABLE &&
    currentUserId !== undefined &&
    refund.requested_by !== currentUserId
  );
}

/** Whether Process is offered: only on an approved refund. */
export function canProcessRefund(refund: Pick<RefundRecord, "status">): boolean {
  return refund.status === REFUND_STATUS_PROCESSABLE;
}

/** What is still refundable, from an over-limit refusal's `meta`; `null` when it carried none. */
export function refundableRemainder(meta: Record<string, unknown>): string | null {
  const value = meta[REFUNDABLE_REMAINDER_META_KEY];
  return typeof value === "string" ? value : null;
}
