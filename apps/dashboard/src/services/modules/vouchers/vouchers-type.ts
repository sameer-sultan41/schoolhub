import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). */
export type VoucherRecord = ApiSchemas["FeeVoucher"];
export type VoucherStatus = VoucherRecord["status"];
export type VoucherFormat = "pdf" | "thermal";

export interface VouchersQuery {
  student?: string;
  invoice?: string;
  status?: VoucherStatus;
  cursor?: string;
  pageSize?: number;
}
