import type { ApiSchemas } from "@schoolhub/api-client";

export type ReceiptRecord = ApiSchemas["Receipt"];
export type ReceiptFormat = "pdf" | "thermal";

export interface ReceiptsQuery {
  payment?: string;
  cursor?: string;
  pageSize?: number;
}
