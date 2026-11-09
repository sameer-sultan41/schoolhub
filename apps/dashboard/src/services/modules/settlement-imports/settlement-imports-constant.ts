import { FILTER_ALL } from "@/lib/constants";
import { VOUCHER_PROVIDERS } from "@/services/modules/vouchers/vouchers-constant";
import type { SettlementImportStatus, SettlementImportsQuery } from "./settlement-imports-type";

/** The settlement-imports module's constants. */

/** The query-key module every import read lives under; a write invalidates it. */
export const SETTLEMENT_IMPORTS_QUERY_MODULE = "settlement-imports";
export const SETTLEMENT_IMPORTS_LIST_RESOURCE = "list";
export const SETTLEMENT_IMPORTS_DETAIL_RESOURCE = "detail";
/** Namespaces the import job's poll (`useJobPolling`). */
export const SETTLEMENT_IMPORTS_JOB_MODULE = "settlement-imports-upload";
/** Rows per page on the Settlement imports tab: the cursor list has no page-size picker. */
export const SETTLEMENT_IMPORTS_PAGE_SIZE = 25;

/** Every status, keyed so the compiler checks the set against the generated enum (L32). */
const SETTLEMENT_STATUSES_SET: Record<SettlementImportStatus, true> = {
  processing: true,
  completed: true,
  failed: true,
};
export const SETTLEMENT_IMPORT_STATUSES = Object.keys(
  SETTLEMENT_STATUSES_SET,
) as SettlementImportStatus[];

/** The file types the server's upload purpose takes (`uploads.SETTLEMENT_FILE`): a bank's CSV. */
export const SETTLEMENT_FILE_ACCEPT = ".csv,text/csv";
/** The body fields an upload refusal can name; each has an input in the dialog. */
export const SETTLEMENT_UPLOAD_ERROR_FIELDS = ["file", "provider"] as const;

/** camelCase `SettlementImportsQuery` key -> the list's query param. */
export const SETTLEMENT_IMPORTS_QUERY_FIELDS: ReadonlyArray<
  readonly [keyof SettlementImportsQuery, string]
> = [
  ["provider", "provider"],
  ["status", "status"],
  ["ordering", "ordering"],
  ["cursor", "cursor"],
  ["pageSize", "page_size"],
];

/** Column id -> the `?ordering=` field `/voucher-collection-imports` accepts. */
export const SETTLEMENT_IMPORTS_SORT_FIELD: Record<string, string> = { created_at: "created_at" };
export const SETTLEMENT_IMPORTS_DEFAULT_SORTING: { id: string; desc: boolean }[] = [
  { id: "created_at", desc: true },
];

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...SETTLEMENT_IMPORT_STATUSES];
const PROVIDER_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...VOUCHER_PROVIDERS];
/** The Settlement imports tab's URL filters (`useDataGridUrlState`). */
export const SETTLEMENT_IMPORTS_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  provider: {
    default: FILTER_ALL,
    isValid: (value: string) => PROVIDER_FILTER_VALUES.includes(value),
  },
};
