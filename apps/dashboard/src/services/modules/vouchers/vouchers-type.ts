import type { ApiSchemas, operations } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). */
export type VoucherRecord = ApiSchemas["FeeVoucher"];
export type VoucherStatus = VoucherRecord["status"];
export type VoucherProvider = VoucherRecord["provider"];
/** The generated `?format=` enum (ADR-0017), not a hand-typed copy. */
export type VoucherFormat = NonNullable<
  operations["vouchers_download_retrieve"]["parameters"]["query"]
>["format"];

export interface VouchersQuery {
  student?: string;
  invoice?: string;
  status?: VoucherStatus;
  provider?: VoucherProvider;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** What issuing a slip takes: the provider, and optionally how many days it stays valid. */
export interface IssueVoucherInput {
  provider: VoucherProvider;
  validityDays?: number | null;
}
