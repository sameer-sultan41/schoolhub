import type { FeeHeadCategory, FeeHeadInput, FeeHeadsQuery } from "./fee-heads-type";

/** The fee-heads module's constants. */

/** The query-key module every feeHead read lives under; a write invalidates it. */
export const FEE_HEADS_QUERY_MODULE = "fee-heads";
export const FEE_HEADS_LIST_RESOURCE = "list";
export const FEE_HEADS_DETAIL_RESOURCE = "detail";

/** Every FeeHeadCategory value, keyed so the compiler checks the set against the generated enum (L32). */
const FEE_HEAD_CATEGORIES_SET: Record<FeeHeadCategory, true> = {
  tuition: true,
  admission: true,
  transport: true,
  library: true,
  exam: true,
  fine: true,
  other: true,
};
export const FEE_HEAD_CATEGORIES = Object.keys(FEE_HEAD_CATEGORIES_SET) as FeeHeadCategory[];

/** camelCase `FeeHeadInput` key -> the API's body key. */
export const FEE_HEADS_BODY_FIELDS: ReadonlyArray<readonly [keyof FeeHeadInput, string]> = [
  ["name", "name"],
  ["code", "code"],
  ["category", "category"],
  ["ledgerAccountId", "ledger_account"],
  ["isRefundable", "is_refundable"],
  ["isActive", "is_active"],
];

/** camelCase `FeeHeadsQuery` key -> the list's query param. */
export const FEE_HEADS_QUERY_FIELDS: ReadonlyArray<readonly [keyof FeeHeadsQuery, string]> = [
  ["search", "search"],
  ["ordering", "ordering"],
  ["category", "category"],
  ["ledgerAccountId", "ledger_account_id"],
  ["isActive", "is_active"],
  ["isRefundable", "is_refundable"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];
