"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { isOffsetPagination, type Page } from "@schoolhub/types";

import {
  hideableColumnIds,
  useDataGridUrlState,
  type FilterSpec,
} from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { toOrdering } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";

/** The page, size, search and sort every paged list sends. A type, not an interface: a type has
 * the implicit index signature that lets the page query be a query-key's params. */
export type PagedListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  ordering?: string;
};

/** A list's full page query: the shared page fields plus the list's own filters. */
export type PageQueryOf<TQuery extends PagedListQuery> = PagedListQuery &
  Omit<TQuery, keyof PagedListQuery>;

export interface PagedListOptions<
  TRow extends { id: string },
  F extends string,
  TQuery extends PagedListQuery,
> {
  /** The query-key module the list's pages live under, so its writes refresh it. */
  queryModule: string;
  /** The query-key resource, under that module. */
  resource: string;
  columns: ColumnDef<TRow>[];
  urlFilters: Record<F, FilterSpec>;
  sortField: Readonly<Record<string, string>>;
  sortableIds: readonly string[];
  defaultSorting: { id: string; desc: boolean }[];
  /** The actions column's id, and whether to show it (false: the viewer may take no action). */
  actionsColumnId: string;
  showActions: boolean;
  /** The URL's filter values as the page query's own filters. */
  toFilterQuery: (filters: Record<F, string>) => Omit<TQuery, keyof PagedListQuery>;
  fetchPage: (query: PageQueryOf<TQuery>) => Promise<Page<TRow>>;
}

/**
 * The read behind a server-paged directory: search, filters, sort, page and hidden columns in the
 * URL (ADR-0024), one page query, the page clamp and stale-page recovery, and the table over it.
 * The screen keeps its columns, filter controls and dialogs. The School structure lists and the
 * platform console's lists both read through it.
 */
export function usePagedList<
  TRow extends { id: string },
  F extends string,
  TQuery extends PagedListQuery,
>({
  queryModule,
  resource,
  columns,
  urlFilters,
  sortField,
  sortableIds,
  defaultSorting,
  actionsColumnId,
  showActions,
  toFilterQuery,
  fetchPage,
}: PagedListOptions<TRow, F, TQuery>) {
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);
  const urlState = useDataGridUrlState({
    filters: urlFilters,
    sortableIds,
    defaultSorting,
    hideableIds,
    trimSearch: true,
  });
  const { filters, search, sorting, pagination, columnVisibility, setPageIndex } = urlState;

  const pageQuery: PageQueryOf<TQuery> = {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined,
    ordering: toOrdering(sorting, sortField),
    ...toFilterQuery(filters),
  };

  const query = useQuery({
    queryKey: queryKeys.list(queryModule, resource, { ...pageQuery }),
    queryFn: () => fetchPage(pageQuery),
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
  const visibility = useMemo(
    () => ({ ...columnVisibility, [actionsColumnId]: showActions }),
    [columnVisibility, actionsColumnId, showActions],
  );

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting, columnVisibility: visibility },
    onPaginationChange: urlState.onPaginationChange,
    onSortingChange: urlState.onSortingChange,
    onColumnVisibilityChange: urlState.onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return { ...urlState, query, table, totalCount, isStalePage };
}
