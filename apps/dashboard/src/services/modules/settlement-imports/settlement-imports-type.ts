import type { ApiSchemas } from "@schoolhub/api-client";

import type { VoucherProvider } from "@/services/modules/vouchers/vouchers-type";

/** The generated wire shape (ADR-0017). */
export type SettlementImportRecord = ApiSchemas["VoucherCollectionImport"];
export type SettlementImportStatus = ApiSchemas["SettlementImportStatusEnum"];

export interface SettlementImportsQuery {
  provider?: VoucherProvider;
  status?: SettlementImportStatus;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** One row of the file that did not post: the server's own wording of why (`apply_settlement_rows`).
 * The record types `exceptions` as `unknown`, so the shape is read through `settlementExceptions`. */
export interface SettlementException {
  row: number;
  providerReference: string;
  amount: string;
  reason: string;
}

/** A finished job's counts, the server's own (`apply_settlement_rows`' return). */
export interface SettlementJobCounts {
  rowCount: number;
  matched: number;
  exceptions: number;
}
