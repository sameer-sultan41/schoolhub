import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017): one line of a posting; the lines of one posting share a `transaction_id`. */
export type LedgerEntryRecord = ApiSchemas["LedgerEntry"];
export type LedgerReferenceType = ApiSchemas["LedgerReferenceTypeEnum"];

export interface LedgerEntriesQuery {
  accountId?: string;
  referenceType?: LedgerReferenceType;
  /** ISO dates bounding `entry_date` (a date column, so plain days are right). */
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  ordering?: string;
  cursor?: string;
  pageSize?: number;
}

/** One line of a manual journal: exactly one of `debit` and `credit` is above zero (the server checks). Amounts are decimal strings. */
export interface JournalLineInput {
  ledgerAccountId: string;
  debit: string;
  credit: string;
}

export interface JournalInput {
  entryDate: string;
  memo: string;
  lines: JournalLineInput[];
}
