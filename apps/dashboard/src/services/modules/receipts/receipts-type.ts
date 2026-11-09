import type { ApiSchemas, operations } from "@schoolhub/api-client";

export type ReceiptRecord = ApiSchemas["Receipt"];
/** The generated `?format=` enum (ADR-0017), not a hand-typed copy. */
export type ReceiptFormat = NonNullable<
  operations["receipts_download_retrieve"]["parameters"]["query"]
>["format"];

export interface ReceiptsQuery {
  payment?: string;
  student?: string;
  cursor?: string;
  pageSize?: number;
}
