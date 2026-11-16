import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toWebsitePageQueryParams } from "./website-pages-helper";
import type {
  PagePreview,
  PageSectionInput,
  PageSectionRecord,
  WebsitePageCreateInput,
  WebsitePageDetail,
  WebsitePageQuery,
  WebsitePageRecord,
  WebsitePageUpdateInput,
} from "./website-pages-type";

/** The website pages API calls (`/website-pages`), reached through `Services.websitePages.*`. */

const paths = endpoints.website.pages;

export async function fetchWebsitePagePage(
  query: WebsitePageQuery = {},
): Promise<Page<WebsitePageRecord>> {
  return fetchPage<WebsitePageRecord>(apiClient, paths.list, {
    query: toWebsitePageQueryParams(query),
  });
}

/** Every published page, by title: what a menu may link to. One `MAX_PAGE_SIZE` page holds a
 * school's site (a menu takes at most 50 items, `NAV_MAX_ITEMS`). */
export async function fetchPublishedWebsitePages(): Promise<WebsitePageRecord[]> {
  const { items } = await fetchWebsitePagePage({
    status: "published",
    ordering: "title",
    pageSize: MAX_PAGE_SIZE,
  });
  return items;
}

export async function fetchWebsitePage(id: string): Promise<WebsitePageDetail> {
  const { data } = await apiClient.get<WebsitePageDetail>(paths.detail(id));
  return data;
}

export async function createWebsitePage(input: WebsitePageCreateInput): Promise<WebsitePageDetail> {
  const { data } = await apiClient.post<WebsitePageDetail>(paths.list, input);
  return data;
}

export async function updateWebsitePage(
  id: string,
  input: WebsitePageUpdateInput,
): Promise<WebsitePageDetail> {
  const { data } = await apiClient.patch<WebsitePageDetail>(paths.detail(id), input);
  return data;
}

export async function deleteWebsitePage(id: string): Promise<void> {
  await apiClient.delete(paths.detail(id));
}

/** Replaces every section of the page, in the order given; a 422 is keyed by JSON path
 * (`sections.1.items.0.answer`). */
export async function replacePageSections(
  id: string,
  sections: PageSectionInput[],
): Promise<PageSectionRecord[]> {
  const { data } = await apiClient.patch<PageSectionRecord[]>(paths.sections(id), { sections });
  return data;
}

export async function publishWebsitePage(id: string): Promise<WebsitePageDetail> {
  const { data } = await apiClient.post<WebsitePageDetail>(paths.publish(id));
  return data;
}

export async function unpublishWebsitePage(id: string): Promise<WebsitePageDetail> {
  const { data } = await apiClient.post<WebsitePageDetail>(paths.unpublish(id));
  return data;
}

export async function archiveWebsitePage(id: string): Promise<WebsitePageDetail> {
  const { data } = await apiClient.post<WebsitePageDetail>(paths.archive(id));
  return data;
}

/** A short-lived preview URL on the school's own host (draft content included). */
export async function previewWebsitePage(id: string): Promise<PagePreview> {
  const { data } = await apiClient.post<PagePreview>(paths.preview(id));
  return data;
}
