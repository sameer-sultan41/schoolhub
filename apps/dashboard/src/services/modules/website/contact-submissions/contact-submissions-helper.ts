import type { QueryParams } from "@schoolhub/api-client";

import type { ContactSubmissionQuery } from "./contact-submissions-type";

/** The inbox's query string: only the filters given are sent. */
export function toContactSubmissionQueryParams(query: ContactSubmissionQuery): QueryParams {
  const params: QueryParams = {};
  if (query.page !== undefined) params.page = query.page;
  if (query.pageSize !== undefined) params.page_size = query.pageSize;
  if (query.search) params.search = query.search;
  if (query.ordering) params.ordering = query.ordering;
  if (query.status) params.status = query.status;
  if (query.createdFrom) params.created_at__gte = query.createdFrom;
  if (query.createdTo) params.created_at__lte = query.createdTo;
  return params;
}
