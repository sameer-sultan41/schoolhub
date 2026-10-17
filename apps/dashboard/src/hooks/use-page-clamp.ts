"use client";

import { useEffect } from "react";
import { isOffsetPagination, type Pagination } from "@schoolhub/types";

import { ApiError } from "@/services";

export interface PageClampOptions {
  /** `Page<T>.pagination` of the query's data: itself optional, and offset-or-cursor. */
  pageMeta: Pagination | undefined;
  isPlaceholderData: boolean;
  error: unknown;
  pageIndex: number;
  setPageIndex: (pageIndex: number) => void;
}

/**
 * The guard every server-paginated `DataGrid` list needs against a page that no longer
 * exists. Returns the page count (1 until the data says otherwise) and whether the current
 * page is stale, which the caller shows as loading rather than as an error.
 *
 * - Clamps back to the last page when this page's own data says the list shrank under the
 *   viewer (exiting the last rows on it, say). Placeholder data is the previous request's
 *   and a cold load has none, so neither can say so.
 * - Goes back to page 1 when the API answers 404 for a page past the end: a shared link to
 *   a page that no longer exists.
 */
export function usePageClamp({
  pageMeta,
  isPlaceholderData,
  error,
  pageIndex,
  setPageIndex,
}: PageClampOptions) {
  // `total_pages` exists only on the offset arm of the `Pagination` union.
  const pageCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_pages : 1;

  const hasPageData = pageMeta !== undefined && !isPlaceholderData;
  useEffect(() => {
    if (!hasPageData) return;
    const lastPageIndex = Math.max(0, pageCount - 1);
    if (pageIndex > lastPageIndex) setPageIndex(lastPageIndex);
  }, [hasPageData, pageCount, pageIndex, setPageIndex]);

  const isStalePage = error instanceof ApiError && error.isNotFound && pageIndex > 0;
  useEffect(() => {
    if (isStalePage) setPageIndex(0);
  }, [isStalePage, setPageIndex]);

  return { pageCount, isStalePage };
}
