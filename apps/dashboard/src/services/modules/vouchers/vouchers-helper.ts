import type { QueryParams } from "@schoolhub/api-client";
import type { VouchersQuery } from "./vouchers-type";

/** The list's query string: only the filters given are sent. */
export function toVouchersQueryParams(query: VouchersQuery): QueryParams {
  const params: QueryParams = {};
  if (query.student !== undefined) params.student = query.student;
  if (query.invoice !== undefined) params.invoice = query.invoice;
  if (query.status !== undefined) params.status = query.status;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
