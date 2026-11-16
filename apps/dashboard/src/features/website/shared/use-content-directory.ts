"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { isOffsetPagination, type Page } from "@schoolhub/types";

import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import {
  WEBSITE_CONTENT_STATUSES,
  WEBSITE_QUERY_MODULE,
  type WebsiteContentQuery,
} from "@/services/shared/website-content";
import type { WebsiteContentStatus } from "@/services";

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...WEBSITE_CONTENT_STATUSES];

/** The URL filters every content directory shares (ADR-0024): one status, or every status. */
export const CONTENT_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
};

/** No sort in the URL means the server's own order (newest first for each kind). */
const SERVER_ORDER: SortingState = [];

/** The status filter as the API takes it: `undefined` for every status. */
export function contentStatusFilter(value: string): WebsiteContentStatus | undefined {
  return WEBSITE_CONTENT_STATUSES.find((status) => status === value);
}

export interface ContentDirectoryOptions<T extends { id: string }> {
  columns: ColumnDef<T>[];
  /** The list's query-key resource, under the `website` module every write invalidates. */
  resource: string;
  /** Sortable column id -> the API's ordering field (its `ordering_fields`). */
  sortField: Readonly<Record<string, string>>;
  fetchPage: (query: WebsiteContentQuery) => Promise<Page<T>>;
}

/**
 * The list state of a news, events or albums directory: search, status, sort, page and hidden
 * columns in the URL, the server-paginated read, the page clamp and the stale-page reset, and
 * the table they drive.
 */
export function useContentDirectory<T extends { id: string }>({
  columns,
  resource,
  sortField,
  fetchPage,
}: ContentDirectoryOptions<T>) {
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);
  const sortableIds = useMemo(() => Object.keys(sortField), [sortField]);
  const urlState = useDataGridUrlState({
    filters: CONTENT_URL_FILTERS,
    sortableIds,
    defaultSorting: SERVER_ORDER,
    hideableIds,
    trimSearch: true,
  });
  const { search, sorting, pagination, columnVisibility, filters, setPageIndex } = urlState;

  const ordering = toOrdering(sorting, sortField);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const status = contentStatusFilter(filters.status);

  const query = useQuery({
    queryKey: queryKeys.list(WEBSITE_QUERY_MODULE, resource, {
      page,
      pageSize,
      search,
      ordering,
      status,
    }),
    queryFn: () => fetchPage({ page, pageSize, search: search || undefined, ordering, status }),
    placeholderData: keepPreviousData,
  });

  const pageMeta = query.data?.pagination;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;
  const { pageCount, isStalePage } = usePageClamp({
    pageMeta,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    pageIndex: pagination.pageIndex,
    setPageIndex,
  });

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);
  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: urlState.onPaginationChange,
    onSortingChange: urlState.onSortingChange,
    onColumnVisibilityChange: urlState.onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return {
    table,
    query,
    totalCount,
    isStalePage,
    hasActiveFilter: search !== "" || status !== undefined,
    searchInput: urlState.searchInput,
    setSearchInput: urlState.setSearchInput,
    status: filters.status,
    setStatus: (value: string) => {
      urlState.setFilters({ status: value || FILTER_ALL });
    },
  };
}

export type ContentDirectory<T extends { id: string }> = ReturnType<typeof useContentDirectory<T>>;
