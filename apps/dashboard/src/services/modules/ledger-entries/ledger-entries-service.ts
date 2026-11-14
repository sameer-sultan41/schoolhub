import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toJournalBody, toLedgerEntriesQueryParams } from "./ledger-entries-helper";
import type { JournalInput, LedgerEntriesQuery, LedgerEntryRecord } from "./ledger-entries-type";

/** The general-ledger API calls (`/ledger-entries`, `fees.ledger.view`), reached through `Services.ledgerEntries.*`. A posting is never edited or deleted: a mistake is corrected by a new, offsetting entry. */

export async function listLedgerEntries(
  query: LedgerEntriesQuery = {},
): Promise<Page<LedgerEntryRecord>> {
  return fetchPage<LedgerEntryRecord>(apiClient, endpoints.ledgerEntries.list, {
    query: toLedgerEntriesQueryParams(query),
  });
}

/**
 * Posts a hand-written journal entry (`POST /ledger-entries:post-journal`, `fees.ledger.create`)
 * and returns its lines. The `Idempotency-Key` is required: a retry after a lost response replays
 * the first posting instead of posting twice onto a ledger that only an offsetting entry can
 * correct. An unbalanced set, or a line naming an archived account, is a 422 and posts nothing.
 */
export async function postJournal(
  input: JournalInput,
  idempotencyKey: string,
): Promise<LedgerEntryRecord[]> {
  const { data } = await apiClient.post<LedgerEntryRecord[]>(
    endpoints.ledgerEntries.postJournal,
    toJournalBody(input),
    { idempotencyKey },
  );
  return data;
}
