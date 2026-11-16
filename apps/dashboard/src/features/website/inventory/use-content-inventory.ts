"use client";

import { useQueries } from "@tanstack/react-query";
import { isOffsetPagination, type Page } from "@schoolhub/types";

import { queryKeys } from "@/lib/query-client";
import { Services, type WebsiteContentQuery, type WebsiteContentStatus } from "@/services";
import { GALLERY_ALBUMS_RESOURCE } from "@/services/modules/website/gallery-albums/gallery-albums-constant";
import { NEWS_POSTS_RESOURCE } from "@/services/modules/website/news-posts/news-posts-constant";
import { SCHOOL_EVENTS_RESOURCE } from "@/services/modules/website/school-events/school-events-constant";
import { WEBSITE_PAGES_RESOURCE } from "@/services/modules/website/website-pages/website-pages-constant";
import { WEBSITE_CONTENT_STATUSES, WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import {
  INVENTORY_KINDS,
  INVENTORY_RESOURCE_SUFFIX,
  STALE_AFTER_MS,
  STALE_SAMPLE_SIZE,
  STALE_STATUS,
  type InventoryKind,
} from "./inventory-constants";

/** The fields every content list row shares, which is all the inventory reads. */
export interface InventoryItem {
  id: string;
  title: string;
  status: WebsiteContentStatus;
  updated_at: string;
}

interface KindSource {
  /** The inventory's own key segment (`pages-inventory`): its reads are derived (a count, a
   * filtered sample), so they never share a cache entry with a list screen's page of the same
   * resource. Still under `WEBSITE_QUERY_MODULE`, so every website write refreshes them. */
  resource: string;
  fetchPage: (query: WebsiteContentQuery) => Promise<Page<InventoryItem>>;
}

const SOURCES: Record<InventoryKind, KindSource> = {
  pages: {
    resource: `${WEBSITE_PAGES_RESOURCE}${INVENTORY_RESOURCE_SUFFIX}`,
    fetchPage: (query) => Services.websitePages.fetchWebsitePagePage(query),
  },
  newsPosts: {
    resource: `${NEWS_POSTS_RESOURCE}${INVENTORY_RESOURCE_SUFFIX}`,
    fetchPage: (query) => Services.newsPosts.fetchNewsPostPage(query),
  },
  schoolEvents: {
    resource: `${SCHOOL_EVENTS_RESOURCE}${INVENTORY_RESOURCE_SUFFIX}`,
    fetchPage: (query) => Services.schoolEvents.fetchSchoolEventPage(query),
  },
  galleryAlbums: {
    resource: `${GALLERY_ALBUMS_RESOURCE}${INVENTORY_RESOURCE_SUFFIX}`,
    fetchPage: (query) => Services.galleryAlbums.fetchGalleryAlbumPage(query),
  },
};

function totalOf(page: Page<InventoryItem>): number {
  return page.pagination && isOffsetPagination(page.pagination)
    ? page.pagination.total_count
    : page.items.length;
}

export type StatusCounts = Record<WebsiteContentStatus, number>;

/** One kind's count per status: a one-row page per status, read for its total. */
export function useStatusCounts(kind: InventoryKind) {
  const source = SOURCES[kind];
  const results = useQueries({
    queries: WEBSITE_CONTENT_STATUSES.map((status) => ({
      queryKey: queryKeys.list(WEBSITE_QUERY_MODULE, source.resource, { status, pageSize: 1 }),
      queryFn: async () => totalOf(await source.fetchPage({ status, pageSize: 1 })),
    })),
  });
  const isPending = results.some((result) => result.isPending);
  const isError = results.some((result) => result.isError);
  const counts =
    isPending || isError
      ? undefined
      : (Object.fromEntries(
          WEBSITE_CONTENT_STATUSES.map((status, index) => [status, results[index]?.data ?? 0]),
        ) as StatusCounts);
  const refetch = () => {
    for (const result of results) if (result.isError) void result.refetch();
  };
  // The first failure's own reason (`module_disabled` when the school's website is off).
  const error = results.find((result) => result.isError)?.error ?? null;
  return { counts, isPending, isError, error, refetch };
}

export interface StaleItem extends InventoryItem {
  kind: InventoryKind;
}

/**
 * Every kind's oldest **published** items, kept when not updated in more than
 * `STALE_AFTER_DAYS`: what the public still sees. Archived rows are never edited again and
 * drafts are already counted by status, so neither may crowd a live item out of the sample. A
 * kind whose whole sample is stale may have more (`hasMore`).
 */
export function useStaleContent() {
  const query = { status: STALE_STATUS, ordering: "updated_at", pageSize: STALE_SAMPLE_SIZE };
  const results = useQueries({
    queries: INVENTORY_KINDS.map((kind) => ({
      queryKey: queryKeys.list(WEBSITE_QUERY_MODULE, SOURCES[kind].resource, query),
      queryFn: async () => {
        const page = await SOURCES[kind].fetchPage(query);
        // The cutoff is taken when the read lands, never during render.
        const cutoff = Date.now() - STALE_AFTER_MS;
        const items = page.items.filter((item) => Date.parse(item.updated_at) < cutoff);
        return { items, hasMore: items.length === STALE_SAMPLE_SIZE };
      },
    })),
  });
  const items: StaleItem[] = results.flatMap((result, index) => {
    const kind = INVENTORY_KINDS[index];
    return kind && result.data ? result.data.items.map((item) => ({ ...item, kind })) : [];
  });
  items.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
  return {
    items,
    hasMore: results.some((result) => result.data?.hasMore === true),
    isPending: results.some((result) => result.isPending),
    isError: results.some((result) => result.isError),
    error: results.find((result) => result.isError)?.error ?? null,
    refetch: () => {
      for (const result of results) if (result.isError) void result.refetch();
    },
  };
}
