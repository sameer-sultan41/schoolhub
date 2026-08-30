import type { CursorPagination, Page, Pagination } from "@schoolhub/types";
import { isCursorPagination } from "@schoolhub/types";
import type { ApiClient, RequestOptions } from "./client";

/** Cursor pagination default: `?cursor=…&page_size=25`, hard max 100 (api-architecture.md §2.4). */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function clampPageSize(pageSize: number | undefined): number {
  if (!pageSize || Number.isNaN(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(pageSize), 1), MAX_PAGE_SIZE);
}

export function cursorOf(pagination: Pagination | undefined): string | null {
  if (!pagination || !isCursorPagination(pagination)) return null;
  return pagination.next_cursor;
}

export interface PaginateOptions extends Omit<RequestOptions, "method" | "body"> {
  /** Stop after this many pages. Guards against a server that never stops handing out cursors. */
  maxPages?: number;
}

/**
 * Fetch one cursor page. The API returns the items as `data` and the cursors in
 * `meta.pagination`, so the caller gets both back in one object.
 */
export async function fetchPage<TItem>(
  client: ApiClient,
  path: string,
  options: Omit<PaginateOptions, "maxPages"> = {},
): Promise<Page<TItem>> {
  const { query, ...rest } = options;
  const result = await client.get<TItem[]>(path, {
    ...rest,
    query: {
      ...query,
      page_size: clampPageSize(typeof query?.page_size === "number" ? query.page_size : undefined),
    },
  });

  return {
    items: Array.isArray(result.data) ? result.data : [],
    ...(result.meta?.pagination ? { pagination: result.meta.pagination } : {}),
  };
}

/**
 * Async-iterate every cursor page.
 *
 * ```ts
 * for await (const page of paginate<Student>(api, "/students")) { … }
 * ```
 */
export async function* paginate<TItem>(
  client: ApiClient,
  path: string,
  options: PaginateOptions = {},
): AsyncGenerator<Page<TItem>, void, undefined> {
  const { maxPages = Number.POSITIVE_INFINITY, query, ...rest } = options;
  let cursor: string | null =
    typeof query?.cursor === "string" && query.cursor.length > 0 ? query.cursor : null;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    const page: Page<TItem> = await fetchPage<TItem>(client, path, {
      ...rest,
      query: { ...query, ...(cursor ? { cursor } : {}) },
    });

    pagesFetched += 1;
    yield page;

    cursor = cursorOf(page.pagination);
    if (!cursor || page.items.length === 0) return;
  }
}

/** Drain the cursor pages into a single array. Bounded by `maxPages` (default 50). */
export async function collectPages<TItem>(
  client: ApiClient,
  path: string,
  options: PaginateOptions = {},
): Promise<TItem[]> {
  const items: TItem[] = [];
  for await (const page of paginate<TItem>(client, path, { maxPages: 50, ...options })) {
    items.push(...page.items);
  }
  return items;
}

/**
 * Shape TanStack Query's `useInfiniteQuery` expects: the next `pageParam` is the
 * next cursor, or `undefined` when the list is exhausted.
 */
export function getNextPageParam<TItem>(lastPage: Page<TItem>): string | undefined {
  return cursorOf(lastPage.pagination) ?? undefined;
}

export type { CursorPagination, Page };
