import { FILTER_ALL } from "@/lib/constants";
import type { RefundStatus, RefundsQuery } from "./refunds-type";

/** The refunds module's constants. */

/** The query-key module every refund read lives under; a write invalidates it. */
export const REFUNDS_QUERY_MODULE = "refunds";
export const REFUNDS_LIST_RESOURCE = "list";
/** Rows per page on the Refunds tab: the cursor list has no page-size picker. */
export const REFUNDS_PAGE_SIZE = 25;

/** Every status, keyed so the compiler checks the set against the generated enum (L32). */
const REFUND_STATUSES_SET: Record<RefundStatus, true> = {
  requested: true,
  approved: true,
  rejected: true,
  processed: true,
};
export const REFUND_STATUSES = Object.keys(REFUND_STATUSES_SET) as RefundStatus[];
/** The only status a refund can be decided from, and the only one it can be processed from. */
export const REFUND_STATUS_DECIDABLE: RefundStatus = "requested";
export const REFUND_STATUS_PROCESSABLE: RefundStatus = "approved";

/** The longest text the server takes for a reason, a decision note and a reference. */
export const REFUND_REASON_MAX = 2000;
export const REFUND_NOTE_MAX = 2000;
export const REFUND_REFERENCE_MAX = 80;

/** The body fields a refusal can name; each has an input in its dialog. Any other field
 * (`approved_by` for self-approval, `status`, `payment`) shows as the dialog's own message. */
export const REFUND_REQUEST_ERROR_FIELDS = ["amount", "reason"] as const;
export const REFUND_DECISION_ERROR_FIELDS = ["note"] as const;
export const REFUND_PROCESS_ERROR_FIELDS = ["method", "reference_no"] as const;

/** The `meta` key the over-limit refusal carries: what is still refundable on the payment. */
export const REFUNDABLE_REMAINDER_META_KEY = "refundable_remainder";

/** camelCase `RefundsQuery` key -> the list's query param. */
export const REFUNDS_QUERY_FIELDS: ReadonlyArray<readonly [keyof RefundsQuery, string]> = [
  ["status", "status"],
  ["paymentId", "payment"],
  ["studentId", "student"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** Column id -> the `?ordering=` field `/refunds` accepts. */
export const REFUNDS_SORT_FIELD: Record<string, string> = {
  created_at: "created_at",
  amount: "amount",
};
export const REFUNDS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "created_at", desc: true },
];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...REFUND_STATUSES];
/** The Refunds tab's URL filters (`useDataGridUrlState`). */
export const REFUNDS_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
};

export type RefundDecision = "approve" | "reject";
