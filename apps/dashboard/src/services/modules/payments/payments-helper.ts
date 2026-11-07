import type { QueryParams } from "@schoolhub/api-client";
import type { PaymentsQuery } from "./payments-type";

/** The list's query string: only the filters given are sent. */
export function toPaymentsQueryParams(query: PaymentsQuery): QueryParams {
  const params: QueryParams = {};
  if (query.invoiceId !== undefined) params.invoice = query.invoiceId;
  if (query.studentId !== undefined) params.student = query.studentId;
  if (query.cursor) params.cursor = query.cursor;
  if (query.pageSize) params.page_size = query.pageSize;
  return params;
}
