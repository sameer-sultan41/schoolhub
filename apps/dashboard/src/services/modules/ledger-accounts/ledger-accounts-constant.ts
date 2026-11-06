import type {
  LedgerAccountType,
  LedgerAccountInput,
  LedgerAccountsQuery,
} from "./ledger-accounts-type";

/** The ledger-accounts module's constants. */

/** The query-key module every ledgerAccount read lives under; a write invalidates it. */
export const LEDGER_ACCOUNTS_QUERY_MODULE = "ledger-accounts";
export const LEDGER_ACCOUNTS_LIST_RESOURCE = "list";
export const LEDGER_ACCOUNTS_DETAIL_RESOURCE = "detail";

/** Every LedgerAccountType value, keyed so the compiler checks the set against the generated enum (L32). */
const LEDGER_ACCOUNT_TYPES_SET: Record<LedgerAccountType, true> = {
  asset: true,
  liability: true,
  equity: true,
  income: true,
  expense: true,
};
export const LEDGER_ACCOUNT_TYPES = Object.keys(LEDGER_ACCOUNT_TYPES_SET) as LedgerAccountType[];

/** camelCase `LedgerAccountInput` key -> the API's body key. */
export const LEDGER_ACCOUNTS_BODY_FIELDS: ReadonlyArray<
  readonly [keyof LedgerAccountInput, string]
> = [
  ["code", "code"],
  ["name", "name"],
  ["accountType", "account_type"],
  ["parentId", "parent"],
  ["isActive", "is_active"],
];

/** camelCase `LedgerAccountsQuery` key -> the list's query param. */
export const LEDGER_ACCOUNTS_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof LedgerAccountsQuery, string]
> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["accountType", "account_type"],
  ["parentId", "parent_id"],
  ["isActive", "is_active"],
  ["isSystem", "is_system"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];
