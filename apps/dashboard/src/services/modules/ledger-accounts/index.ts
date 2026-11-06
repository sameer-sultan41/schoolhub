import {
  createLedgerAccount,
  deleteLedgerAccount,
  fetchLedgerAccount,
  listLedgerAccounts,
  updateLedgerAccount,
} from "./ledger-accounts-service";

export const LedgerAccountsService = {
  listLedgerAccounts,
  fetchLedgerAccount,
  createLedgerAccount,
  updateLedgerAccount,
  deleteLedgerAccount,
};
export type {
  LedgerAccountType,
  LedgerAccountInput,
  LedgerAccountRecord,
  LedgerAccountsQuery,
} from "./ledger-accounts-type";
