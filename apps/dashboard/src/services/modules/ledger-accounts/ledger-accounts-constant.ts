import { FILTER_ALL } from "@/lib/constants";
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

export const LEDGER_CODE_MAX = 20;
export const LEDGER_NAME_MAX = 120;
/** Rows per page: the cursor list has no page-size picker. */
export const LEDGER_ACCOUNTS_PAGE_SIZE = 25;
export const LEDGER_ACCOUNTS_ACTIONS_COLUMN_ID = "actions";

/** Column id -> the `?ordering=` field `/ledger-accounts` accepts. */
export const LEDGER_ACCOUNTS_SORT_FIELD: Record<string, string> = { code: "code", name: "name" };
export const LEDGER_ACCOUNTS_SORTABLE_IDS = Object.keys(LEDGER_ACCOUNTS_SORT_FIELD);
export const LEDGER_ACCOUNTS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "code", desc: false },
];

/** The `active` and `system` URL filters' values (besides `all`). */
export const LEDGER_ACTIVE_FILTERS = ["active", "inactive"] as const;
export const LEDGER_SYSTEM_FILTERS = ["system", "custom"] as const;

const LEDGER_TYPE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...LEDGER_ACCOUNT_TYPES];
const LEDGER_ACTIVE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...LEDGER_ACTIVE_FILTERS];
const LEDGER_SYSTEM_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...LEDGER_SYSTEM_FILTERS];

/** The accounts list's URL filters (`useDataGridUrlState`). */
export const LEDGER_ACCOUNTS_URL_FILTERS = {
  type: {
    default: FILTER_ALL,
    isValid: (value: string) => LEDGER_TYPE_FILTER_VALUES.includes(value),
  },
  active: {
    default: FILTER_ALL,
    isValid: (value: string) => LEDGER_ACTIVE_FILTER_VALUES.includes(value),
  },
  system: {
    default: FILTER_ALL,
    isValid: (value: string) => LEDGER_SYSTEM_FILTER_VALUES.includes(value),
  },
};

/** The URL keys of the accounts list's filters: a tab change drops them. */
export const LEDGER_ACCOUNTS_FILTER_KEYS = Object.keys(LEDGER_ACCOUNTS_URL_FILTERS);

/** The query resource a picker's read of the accounts lives under. */
export const LEDGER_ACCOUNTS_OPTIONS_RESOURCE = "options";

/** The form's fields that have an input: a server error on any other folds into the form's message. */
export const LEDGER_ACCOUNT_ERROR_FIELDS = [
  "code",
  "name",
  "account_type",
  "parent",
  "is_active",
] as const;

export const DEFAULT_LEDGER_ACCOUNT_TYPE: LedgerAccountType = "asset";
/** The parent select's empty choice: a top-level account. */
export const NO_PARENT_OPTION = "none";
