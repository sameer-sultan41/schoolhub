import {
  createLedgerAccount,
  deleteLedgerAccount,
  fetchLedgerAccount,
  fetchLedgerAccountOptions,
  listLedgerAccounts,
  updateLedgerAccount,
} from "./ledger-accounts-service";

export const LedgerAccountsService = {
  listLedgerAccounts,
  fetchLedgerAccount,
  fetchLedgerAccountOptions,
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
