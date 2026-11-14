import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). */
export type PaymentRecord = ApiSchemas["Payment"];
export type PaymentMethod = ApiSchemas["PaymentMethodEnum"];
export type PaymentStatus = ApiSchemas["PaymentStatusEnum"];
/** What a counter may take: every method but the gateway's, which `:record` refuses. */
export type CounterPaymentMethod = Exclude<PaymentMethod, "online_gateway">;

export interface PaymentsQuery {
  invoiceId?: string;
  studentId?: string;
  method?: PaymentMethod;
  status?: PaymentStatus;
  /** Offset-aware ISO instants bounding `paid_at`: from (inclusive) and before (exclusive). */
  paidAtGte?: string;
  paidAtLt?: string;
  /** The cashier (a user id). */
  receivedBy?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** `:record`'s body: money against one invoice. `referenceNo` is required for a cheque or transfer. */
export interface RecordPaymentInput {
  feeInvoiceId: string;
  amount: string;
  method: CounterPaymentMethod;
  referenceNo?: string | null;
}
