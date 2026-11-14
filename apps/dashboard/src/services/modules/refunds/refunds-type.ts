import type { ApiSchemas } from "@schoolhub/api-client";

import type { CounterPaymentMethod } from "@/services/modules/payments/payments-type";

/** The generated wire shape (ADR-0017). */
export type RefundRecord = ApiSchemas["Refund"];
export type RefundStatus = ApiSchemas["RefundStatusEnum"];

export interface RefundsQuery {
  status?: RefundStatus;
  paymentId?: string;
  studentId?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** `:create`'s body: money back against one confirmed payment, bounded by what is still refundable. */
export interface RequestRefundInput {
  paymentId: string;
  amount: string;
  reason: string;
}

/** `:approve` / `:reject`: the note is optional on the wire; the dialog asks for one on a rejection. */
export interface RefundDecisionInput {
  note?: string | null;
}

/** `:process`: how the money went back. The gateway is not a way a school pays out. */
export interface ProcessRefundInput {
  method: CounterPaymentMethod;
  referenceNo?: string | null;
}
