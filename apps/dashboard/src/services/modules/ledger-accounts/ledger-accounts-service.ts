import { fetchPage } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";
import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toLedgerAccountBody, toLedgerAccountsQueryParams } from "./ledger-accounts-helper";
import type {
  LedgerAccountInput,
  LedgerAccountRecord,
  LedgerAccountsQuery,
} from "./ledger-accounts-type";

/** The ledger-accounts API calls (`/ledger-accounts`), reached through `Services.ledgerAccounts.*`. */

export async function listLedgerAccounts(
  query: LedgerAccountsQuery = {},
): Promise<Page<LedgerAccountRecord>> {
  return fetchPage<LedgerAccountRecord>(apiClient, endpoints.ledgerAccounts.list, {
    query: toLedgerAccountsQueryParams(query),
  });
}

export async function fetchLedgerAccount(id: string): Promise<LedgerAccountRecord> {
  const { data } = await apiClient.get<LedgerAccountRecord>(endpoints.ledgerAccounts.detail(id));
  return data;
}

export async function createLedgerAccount(input: LedgerAccountInput): Promise<LedgerAccountRecord> {
  const { data } = await apiClient.post<LedgerAccountRecord>(
    endpoints.ledgerAccounts.list,
    toLedgerAccountBody(input),
  );
  return data;
}

export async function updateLedgerAccount(
  id: string,
  input: Partial<LedgerAccountInput>,
): Promise<LedgerAccountRecord> {
  const { data } = await apiClient.patch<LedgerAccountRecord>(
    endpoints.ledgerAccounts.detail(id),
    toLedgerAccountBody(input),
  );
  return data;
}

export async function deleteLedgerAccount(id: string): Promise<void> {
  await apiClient.delete(endpoints.ledgerAccounts.detail(id));
}
