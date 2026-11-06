import type { QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import {
  LEDGER_ACCOUNTS_BODY_FIELDS,
  LEDGER_ACCOUNTS_QUERY_FIELDS,
} from "./ledger-accounts-constant";
import type { LedgerAccountInput, LedgerAccountsQuery } from "./ledger-accounts-type";

/** The ledger-accounts module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toLedgerAccountsQueryParams(query: LedgerAccountsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    LEDGER_ACCOUNTS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as QueryParams;
}

/** A create or update body: only the fields given, in the API's snake_case. */
export function toLedgerAccountBody(input: Partial<LedgerAccountInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, LEDGER_ACCOUNTS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}
