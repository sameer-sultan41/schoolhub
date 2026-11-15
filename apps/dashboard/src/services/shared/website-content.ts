import type { ApiSchemas, QueryParams } from "@schoolhub/api-client";

/**
 * What the website-cms domains share: pages, news posts, school events and gallery albums all
 * carry the same draft / published / archived status and the same list filters. Each domain
 * keeps its own five files (ADR-0019) and builds on these.
 */

export type WebsiteContentStatus = ApiSchemas["WebsiteContentStatusEnum"];

/** The query-key module every website read lives under, so any website write refreshes the
 * content inventory too. */
export const WEBSITE_QUERY_MODULE = "website";

/** Every content status, keyed so the compiler checks the set against the generated enum. */
const CONTENT_STATUS_SET: Record<WebsiteContentStatus, true> = {
  draft: true,
  published: true,
  archived: true,
};
export const WEBSITE_CONTENT_STATUSES = Object.keys(CONTENT_STATUS_SET) as WebsiteContentStatus[];

/** The list filters every content endpoint takes. */
export interface WebsiteContentQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
  status?: WebsiteContentStatus;
}

/** The list's query string: only the filters given are sent; `extra` adds a domain's own. */
export function toContentQueryParams(
  query: WebsiteContentQuery,
  extra: QueryParams = {},
): QueryParams {
  const params: QueryParams = {};
  if (query.page !== undefined) params.page = query.page;
  if (query.pageSize !== undefined) params.page_size = query.pageSize;
  if (query.search) params.search = query.search;
  if (query.ordering) params.ordering = query.ordering;
  if (query.status) params.status = query.status;
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") params[key] = value;
  }
  return params;
}
