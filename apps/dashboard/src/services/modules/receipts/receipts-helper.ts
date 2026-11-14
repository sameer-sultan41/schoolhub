import type { QueryParams } from "@schoolhub/api-client";
import { copyMappedFields } from "@/lib/helpers";
import { RECEIPTS_QUERY_FIELDS } from "./receipts-constant";
import type { ReceiptsQuery } from "./receipts-type";

/** The list's query string: only the filters given are sent. */
export function toReceiptsQueryParams(query: ReceiptsQuery): QueryParams {
  const params: Record<string, unknown> = {};
  copyMappedFields(
    query,
    RECEIPTS_QUERY_FIELDS,
    (value) => value !== undefined && value !== "" && value !== 0,
    params,
  );
  return params as QueryParams;
}
