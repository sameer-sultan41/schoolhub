import type { ReceiptsQuery } from "./receipts-type";

/** The receipts module's constants. */

/** The query-key module every receipt read lives under. */
export const RECEIPTS_QUERY_MODULE = "receipts";
export const RECEIPTS_LIST_RESOURCE = "list";
/** Rows per page on the Receipts tab: the cursor list has no page-size picker. */
export const RECEIPTS_PAGE_SIZE = 25;

/** camelCase `ReceiptsQuery` key -> the list's query param. */
export const RECEIPTS_QUERY_FIELDS: ReadonlyArray<readonly [keyof ReceiptsQuery, string]> = [
  ["payment", "payment"],
  ["student", "student"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** Column id -> the `?ordering=` field `/receipts` accepts. */
export const RECEIPTS_SORT_FIELD: Record<string, string> = {
  issued_at: "issued_at",
  amount: "amount",
};
export const RECEIPTS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "issued_at", desc: true },
];
