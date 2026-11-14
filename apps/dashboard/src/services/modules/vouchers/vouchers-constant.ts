import { FILTER_ALL } from "@/lib/constants";
import type { VoucherProvider, VoucherStatus, VouchersQuery } from "./vouchers-type";

/** The vouchers module's constants. */

/** The query-key module every voucher read lives under; a write invalidates it. */
export const VOUCHERS_QUERY_MODULE = "vouchers";
export const VOUCHERS_BY_INVOICE_RESOURCE = "by-invoice";
export const VOUCHERS_LIST_RESOURCE = "list";
/** One invoice has a handful of vouchers: one page is its whole list. */
export const VOUCHERS_BY_INVOICE_PAGE_SIZE = 100;
/** Rows per page on the Vouchers tab: the cursor list has no page-size picker. */
export const VOUCHERS_PAGE_SIZE = 25;

/** Every status and provider, keyed so the compiler checks the set against the generated enum (L32). */
const VOUCHER_STATUSES_SET: Record<VoucherStatus, true> = {
  issued: true,
  paid: true,
  void: true,
  expired: true,
};
export const VOUCHER_STATUSES = Object.keys(VOUCHER_STATUSES_SET) as VoucherStatus[];
const VOUCHER_PROVIDERS_SET: Record<VoucherProvider, true> = {
  bank_branch: true,
  easypaisa: true,
  jazzcash: true,
};
export const VOUCHER_PROVIDERS = Object.keys(VOUCHER_PROVIDERS_SET) as VoucherProvider[];
export const DEFAULT_VOUCHER_PROVIDER: VoucherProvider = "bank_branch";
/** Only an issued slip can be voided: a paid one is refused by the server, and a void or expired one is already out of use. */
export const VOUCHER_STATUS_VOIDABLE: VoucherStatus = "issued";

/** The longest reason the server takes (`WaiveSerializer.reason`). */
export const VOUCHER_REASON_MAX = 2000;
/** The longest validity the server takes, in days (`IssueVoucherSerializer.validity_days`). */
export const VOUCHER_VALIDITY_DAYS_MAX = 365;

/** The body fields a refusal can name; each has an input in its dialog. */
export const VOUCHER_ISSUE_ERROR_FIELDS = ["provider", "validity_days"] as const;
export const VOUCHER_VOID_ERROR_FIELDS = ["reason"] as const;

/** camelCase `VouchersQuery` key -> the list's query param. */
export const VOUCHERS_QUERY_FIELDS: ReadonlyArray<readonly [keyof VouchersQuery, string]> = [
  ["student", "student"],
  ["invoice", "invoice"],
  ["status", "status"],
  ["provider", "provider"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** Column id -> the `?ordering=` field `/vouchers` accepts. */
export const VOUCHERS_SORT_FIELD: Record<string, string> = {
  due_date: "due_date",
  created_at: "created_at",
};
export const VOUCHERS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "created_at", desc: true },
];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...VOUCHER_STATUSES];
const PROVIDER_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...VOUCHER_PROVIDERS];
/** The Vouchers tab's URL filters (`useDataGridUrlState`). */
export const VOUCHERS_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  provider: {
    default: FILTER_ALL,
    isValid: (value: string) => PROVIDER_FILTER_VALUES.includes(value),
  },
};
