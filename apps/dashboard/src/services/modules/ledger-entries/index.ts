import { listLedgerEntries, postJournal } from "./ledger-entries-service";

export const LedgerEntriesService = {
  listLedgerEntries,
  postJournal,
};
export type {
  JournalInput,
  JournalLineInput,
  LedgerEntriesQuery,
  LedgerEntryRecord,
  LedgerReferenceType,
} from "./ledger-entries-type";
