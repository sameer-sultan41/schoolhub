import type { QueryParams } from "@schoolhub/api-client";
import type { FeeInvoicesQuery } from "./fee-invoices-type";

/** The list's query string: only the filters given are sent. */
export function toFeeInvoicesQueryParams(query: FeeInvoicesQuery): QueryParams {
  const params: QueryParams = {};
  if (query.studentId !== undefined) params.student = query.studentId;
  if (query.outstanding !== undefined) params.outstanding = query.outstanding;
  if (query.status !== undefined) params.status = query.status;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
