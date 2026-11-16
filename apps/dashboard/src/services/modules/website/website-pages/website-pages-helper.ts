import type { QueryParams } from "@schoolhub/api-client";

import { toContentQueryParams } from "@/services/shared/website-content";
import { DEFAULT_PAGE_TYPE, HOME_PAGE_TYPE } from "./website-pages-constant";
import type { PageFormValues } from "./website-pages.schema";
import type {
  WebsitePageCreateInput,
  WebsitePageQuery,
  WebsitePageRecord,
  WebsitePageUpdateInput,
} from "./website-pages-type";

/** The pages list's query string: the shared content filters plus `page_type`. */
export function toWebsitePageQueryParams(query: WebsitePageQuery): QueryParams {
  return toContentQueryParams(query, { page_type: query.pageType });
}

/** Where a page is served: the home page at `/`, any other at `/<slug>`. */
export function pagePublicPath(page: Pick<WebsitePageRecord, "page_type" | "slug">): string {
  return page.page_type === HOME_PAGE_TYPE ? "/" : `/${page.slug}`;
}

/** The details form's starting values: the page's own, or a new standard page's. */
export function pageFormValues(page?: WebsitePageRecord): PageFormValues {
  return {
    title: page?.title ?? "",
    slug: page?.slug ?? "",
    page_type: page?.page_type ?? DEFAULT_PAGE_TYPE,
    show_in_search: page?.show_in_search ?? true,
  };
}

export function buildPageCreateInput(values: PageFormValues): WebsitePageCreateInput {
  return {
    title: values.title.trim(),
    slug: values.slug.trim(),
    page_type: values.page_type,
    show_in_search: values.show_in_search,
  };
}

/** A details edit; the home page's address is never sent (it is served at `/`). */
export function buildPageUpdateInput(
  values: PageFormValues,
  page: WebsitePageRecord,
): WebsitePageUpdateInput {
  return {
    title: values.title.trim(),
    ...(page.page_type === HOME_PAGE_TYPE ? {} : { slug: values.slug.trim() }),
    show_in_search: values.show_in_search,
  };
}
