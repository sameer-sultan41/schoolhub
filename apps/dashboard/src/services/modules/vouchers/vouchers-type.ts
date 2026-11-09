import type { ApiSchemas, operations } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). */
export type VoucherRecord = ApiSchemas["FeeVoucher"];
export type VoucherStatus = VoucherRecord["status"];
/** The generated `?format=` enum (ADR-0017), not a hand-typed copy. */
export type VoucherFormat = NonNullable<
  operations["vouchers_download_retrieve"]["parameters"]["query"]
>["format"];

export interface VouchersQuery {
  student?: string;
  invoice?: string;
  status?: VoucherStatus;
  cursor?: string;
  pageSize?: number;
}
