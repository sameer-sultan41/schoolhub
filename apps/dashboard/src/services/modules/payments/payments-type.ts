import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). */
export type PaymentRecord = ApiSchemas["Payment"];
export type PaymentMethod = ApiSchemas["PaymentMethodEnum"];
export type PaymentStatus = ApiSchemas["PaymentStatusEnum"];

export interface PaymentsQuery {
  invoiceId?: string;
  studentId?: string;
  cursor?: string;
  pageSize?: number;
}
