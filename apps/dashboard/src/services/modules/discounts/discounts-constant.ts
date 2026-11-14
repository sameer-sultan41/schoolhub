import { FILTER_ALL } from "@/lib/constants";
import { isUuid } from "@/lib/helpers";
import type { DiscountInput, DiscountsQuery, DiscountStatus, DiscountType } from "./discounts-type";

/** The discounts module's constants. */

/** The query-key module every discount read lives under; a write invalidates it. */
export const DISCOUNTS_QUERY_MODULE = "discounts";
export const DISCOUNTS_LIST_RESOURCE = "list";

/** Every status and type, keyed so the compiler checks the set against the generated enum (L32). */
const DISCOUNT_STATUSES_SET: Record<DiscountStatus, true> = {
  active: true,
  expired: true,
  revoked: true,
};
export const DISCOUNT_STATUSES = Object.keys(DISCOUNT_STATUSES_SET) as DiscountStatus[];
const DISCOUNT_TYPES_SET: Record<DiscountType, true> = { percent: true, fixed: true };
export const DISCOUNT_TYPES = Object.keys(DISCOUNT_TYPES_SET) as DiscountType[];
export const DEFAULT_DISCOUNT_TYPE: DiscountType = "percent";
/** Only an active grant can be revoked: an expired or revoked one has nothing left to end. */
export const DISCOUNT_STATUS_REVOKABLE: DiscountStatus = "active";

/** camelCase `DiscountInput` key -> the API's body key. */
export const DISCOUNTS_BODY_FIELDS: ReadonlyArray<readonly [keyof DiscountInput, string]> = [
  ["studentId", "student"],
  ["academicSessionId", "academic_session"],
  ["name", "name"],
  ["discountType", "discount_type"],
  ["value", "value"],
  ["feeHeadId", "fee_head"],
  ["validFrom", "valid_from"],
  ["validTo", "valid_to"],
  ["reason", "reason"],
];

/** camelCase `DiscountsQuery` key -> the list's query param. */
export const DISCOUNTS_QUERY_FIELDS: ReadonlyArray<readonly [keyof DiscountsQuery, string]> = [
  ["studentId", "student"],
  ["academicSessionId", "academic_session_id"],
  ["feeHeadId", "fee_head_id"],
  ["discountType", "discount_type"],
  ["status", "status"],
  ["search", "search"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

export const DISCOUNT_NAME_MAX = 120;
export const DISCOUNT_REASON_MAX = 2000;
/** Rows per page: the cursor list has no page-size picker. */
export const DISCOUNTS_PAGE_SIZE = 25;

/** Column id -> the `?ordering=` field `/discounts` accepts. */
export const DISCOUNTS_SORT_FIELD: Record<string, string> = {
  created_at: "created_at",
  value: "value",
};
export const DISCOUNTS_SORTABLE_IDS = Object.keys(DISCOUNTS_SORT_FIELD);
export const DISCOUNTS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "created_at", desc: true },
];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...DISCOUNT_STATUSES];
const isIdOrBlank = (value: string) => value === "" || isUuid(value);

/** The discounts list's URL filters (`useDataGridUrlState`); `student` is set by a link and cleared on the tab. */
export const DISCOUNTS_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  student: { default: "", isValid: isIdOrBlank },
};

/** The create form's fields that have an input: a server error on any other folds into the form's message. */
export const DISCOUNT_ERROR_FIELDS = [
  "student",
  "academic_session",
  "name",
  "discount_type",
  "value",
  "fee_head",
  "valid_from",
  "valid_to",
  "reason",
] as const;
export const DISCOUNT_REVOKE_ERROR_FIELDS = ["reason"] as const;
