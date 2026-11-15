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
import type { StructurePageQuery } from "@/services";
import {
  SCHOOL_ORGANIZATION_QUERY_MODULE,
  STRUCTURE_ACTIONS_COLUMN_ID,
} from "@/services/modules/school-organization/school-organization-constant";

/** What a list's own filters add to the page query (the status, a campus, a type). */
export type StructureFilterQuery = Omit<
  StructurePageQuery,
  "page" | "pageSize" | "search" | "ordering"
>;

export interface StructureListOptions<TRow extends { id: string }, F extends string> {
  /** The query-key resource the list's pages live under, in the school-organization module. */
  resource: string;
  columns: ColumnDef<TRow>[];
  urlFilters: Record<F, FilterSpec>;
  sortField: Readonly<Record<string, string>>;
  sortableIds: readonly string[];
  defaultSorting: { id: string; desc: boolean }[];
  /** False hides the actions column: the viewer may neither edit nor remove. */
  showActions: boolean;
  /** True lets every row open onto its first column's `expandedContent` (a class's sections). */
  expandableRows?: boolean;
  /** The URL's filter values as the page query's filters. */
  toFilterQuery: (filters: Record<F, string>) => StructureFilterQuery;
  fetchPage: (query: StructurePageQuery) => Promise<Page<TRow>>;
}

/**
 * The read behind one of the School module's paged structure lists: the search, filters, sort,
 * page and hidden columns in the URL (ADR-0024), one page query, the stale-page guard, and the
 * table over it. The screen keeps its columns, filter controls and dialogs.
 */
export function useStructureList<TRow extends { id: string }, F extends string>({
  resource,
  columns,
  urlFilters,
  sortField,
  sortableIds,
  defaultSorting,
  showActions,
  expandableRows = false,
  toFilterQuery,
  fetchPage,
}: StructureListOptions<TRow, F>) {
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);
  const urlState = useDataGridUrlState({
    filters: urlFilters,
    sortableIds,
    defaultSorting,
    hideableIds,
    trimSearch: true,
  });
  const { filters, search, sorting, pagination, columnVisibility, setPageIndex } = urlState;

  const pageQuery: StructurePageQuery = {
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined,
    ordering: toOrdering(sorting, sortField),
    ...toFilterQuery(filters),
  };

  const query = useQuery({
    queryKey: queryKeys.list(SCHOOL_ORGANIZATION_QUERY_MODULE, resource, { ...pageQuery }),
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
    () => ({ ...columnVisibility, [STRUCTURE_ACTIONS_COLUMN_ID]: showActions }),
    [columnVisibility, showActions],
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
    getRowCanExpand: () => expandableRows,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return { ...urlState, query, table, totalCount, isStalePage };
}
