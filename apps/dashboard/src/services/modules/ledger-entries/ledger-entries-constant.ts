import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type { LedgerEntriesQuery, LedgerReferenceType } from "./ledger-entries-type";

/** The ledger-entries module's constants. */

export const LEDGER_ENTRIES_QUERY_MODULE = "ledger-entries";
export const LEDGER_ENTRIES_LIST_RESOURCE = "list";
export const LEDGER_ENTRIES_PAGE_SIZE = 25;

/** The memo's length on the wire (`ManualJournalSerializer.memo`). */
export const JOURNAL_MEMO_MAX = 255;
/** A posting has at least two lines, one debit and one credit (the server's own rule). */
export const JOURNAL_MIN_LINES = 2;

/** Every reference type, keyed so the compiler checks the set against the generated enum (L32). */
const LEDGER_REFERENCE_TYPES_SET: Record<LedgerReferenceType, true> = {
  payment: true,
  refund: true,
  expense: true,
  payroll_run: true,
  fine: true,
  manual: true,
  reversal: true,
};
export const LEDGER_REFERENCE_TYPES = Object.keys(
  LEDGER_REFERENCE_TYPES_SET,
) as LedgerReferenceType[];

/** camelCase `LedgerEntriesQuery` key -> the list's query param. */
export const LEDGER_ENTRIES_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof LedgerEntriesQuery, string]
> = [
  ["accountId", "account"],
  ["referenceType", "reference_type"],
  ["dateFrom", "date__gte"],
  ["dateTo", "date__lte"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** Column id -> the `?ordering=` field `/ledger-entries` accepts. */
export const LEDGER_ENTRIES_SORT_FIELD: Record<string, string> = {
  entry_date: "entry_date",
};
export const LEDGER_ENTRIES_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "entry_date", desc: true },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isDateOrBlank = (value: string) => value === "" || DATE_PATTERN.test(value);
const REFERENCE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...LEDGER_REFERENCE_TYPES];

/** The Journal tab's URL filters (`useDataGridUrlState`); `account` is an id, kept only when it is a UUID (a bad one is ignored, not sent as a 400). */
export const LEDGER_ENTRIES_URL_FILTERS = {
  account: { default: "", isValid: (value: string) => value === "" || isUuid(value) },
  from: { default: "", isValid: isDateOrBlank },
  to: { default: "", isValid: isDateOrBlank },
  reference: {
    default: FILTER_ALL,
    isValid: (value: string) => REFERENCE_FILTER_VALUES.includes(value),
  },
};
export const LEDGER_ENTRIES_FILTER_KEYS = Object.keys(LEDGER_ENTRIES_URL_FILTERS);

/** The ledger page's sub-tab ids, as `?tab=` carries them. Accounts is first, so it is the default. */
export const LEDGER_ACCOUNTS_TAB_ID = "accounts";
export const LEDGER_JOURNAL_TAB_ID = "journal";

/** The journal form's fields that have an input: a server error on any other (`lines`, a balance refusal) folds into the form's message. */
export const JOURNAL_ERROR_FIELDS = ["entry_date", "memo"] as const;
/** A journal line's inputs, by the name the form and the server's `lines[i].<name>` share. */
export const JOURNAL_LINE_FIELDS = ["ledger_account", "debit", "credit"] as const;
