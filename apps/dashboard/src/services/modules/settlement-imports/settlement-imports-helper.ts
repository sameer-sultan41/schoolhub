import type { QueryParams } from "@schoolhub/api-client";
import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import { VOUCHER_PROVIDERS } from "@/services/modules/vouchers/vouchers-constant";
import type { VoucherProvider } from "@/services/modules/vouchers/vouchers-type";
import {
  SETTLEMENT_IMPORT_STATUSES,
  SETTLEMENT_IMPORTS_QUERY_FIELDS,
} from "./settlement-imports-constant";
import type {
  SettlementException,
  SettlementImportsQuery,
  SettlementImportStatus,
  SettlementJobCounts,
} from "./settlement-imports-type";

/** The settlement-imports module's pure helpers: plain data in, plain data out. */

/** The list's query string: only the filters given are sent. */
export function toSettlementImportsQueryParams(query: SettlementImportsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    SETTLEMENT_IMPORTS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "" && value !== 0,
    params,
  );
  return params as QueryParams;
}

/** The upload's multipart body: the file and its provider, as `SettlementImportRequest` names them. */
export function toSettlementUploadBody(file: File, provider: VoucherProvider): FormData {
  const body = new FormData();
  body.append("file", file);
  body.append("provider", provider);
  return body;
}

export function settlementStatusFilter(value: string): SettlementImportStatus | undefined {
  return value === FILTER_ALL
    ? undefined
    : SETTLEMENT_IMPORT_STATUSES.find((status) => status === value);
}

export function settlementProviderFilter(value: string): VoucherProvider | undefined {
  return value === FILTER_ALL
    ? undefined
    : VOUCHER_PROVIDERS.find((provider) => provider === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The rows that did not post, read from the record's `exceptions` (typed `unknown` by the
 * contract: `{row, provider_reference, amount, reason}` per row). An entry without a reason is
 * not an exception the viewer can act on, so it is dropped rather than shown blank.
 */
export function settlementExceptions(value: unknown): SettlementException[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.reason !== "string") return [];
    return [
      {
        row: typeof entry.row === "number" ? entry.row : Number(entry.row) || 0,
        providerReference:
          typeof entry.provider_reference === "string" ? entry.provider_reference : "",
        amount: typeof entry.amount === "string" ? entry.amount : "",
        reason: entry.reason,
      },
    ];
  });
}

/** A finished job's own counts; zeros for a result that carries none. */
export function settlementJobCounts(result: Record<string, unknown> | null): SettlementJobCounts {
  const count = (key: string) => {
    const value = result?.[key];
    return typeof value === "number" ? value : 0;
  };
  return {
    rowCount: count("row_count"),
    matched: count("matched"),
    exceptions: count("exceptions"),
  };
}
