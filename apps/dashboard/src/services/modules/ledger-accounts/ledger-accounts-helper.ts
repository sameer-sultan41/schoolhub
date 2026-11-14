import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import {
  DEFAULT_LEDGER_ACCOUNT_TYPE,
  LEDGER_ACCOUNTS_BODY_FIELDS,
  LEDGER_ACCOUNTS_QUERY_FIELDS,
} from "./ledger-accounts-constant";
import type { LedgerAccountFormValues } from "./ledger-accounts.schema";
import type {
  LedgerAccountInput,
  LedgerAccountRecord,
  LedgerAccountsQuery,
  LedgerAccountType,
} from "./ledger-accounts-type";

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

/** A URL filter's picked value, or `undefined` for "all" (no filter sent). */
export function ledgerTypeFilter(value: string): LedgerAccountType | undefined {
  return value === FILTER_ALL ? undefined : (value as LedgerAccountType);
}

/** The `active` filter -> `is_active`. */
export function activeFilterToFlag(value: string): boolean | undefined {
  if (value === "active") return true;
  if (value === "inactive") return false;
  return undefined;
}

/** The `system` filter -> `is_system`. */
export function systemFilterToFlag(value: string): boolean | undefined {
  if (value === "system") return true;
  if (value === "custom") return false;
  return undefined;
}

export function defaultLedgerAccountFormValues(): LedgerAccountFormValues {
  return {
    code: "",
    name: "",
    account_type: DEFAULT_LEDGER_ACCOUNT_TYPE,
    parent: "",
    is_active: true,
  };
}

export function recordToLedgerAccountFormValues(
  record: LedgerAccountRecord,
): LedgerAccountFormValues {
  return {
    code: record.code,
    name: record.name,
    account_type: record.account_type,
    parent: record.parent ?? "",
    is_active: record.is_active ?? true,
  };
}

/** Form values -> the service input; no parent is a top-level account (`null` clears it on edit). */
export function buildLedgerAccountInput(values: LedgerAccountFormValues): LedgerAccountInput {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    accountType: values.account_type,
    parentId: values.parent === "" ? null : values.parent,
    isActive: values.is_active,
  };
}
