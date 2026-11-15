import type { QueryParams } from "@schoolhub/api-client";

import { toContentQueryParams } from "@/services/shared/website-content";
import type { WebsitePageQuery } from "./website-pages-type";

/** The pages list's query string: the shared content filters plus `page_type`. */
export function toWebsitePageQueryParams(query: WebsitePageQuery): QueryParams {
  return toContentQueryParams(query, { page_type: query.pageType });
}
