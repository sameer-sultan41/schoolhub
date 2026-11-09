import type { QueryParams } from "@schoolhub/api-client";
import type { ReceiptsQuery } from "./receipts-type";

/** The list's query string: only the filters given are sent. */
export function toReceiptsQueryParams(query: ReceiptsQuery): QueryParams {
  const params: QueryParams = {};
  if (query.payment !== undefined) params.payment = query.payment;
  if (query.student !== undefined) params.student = query.student;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
