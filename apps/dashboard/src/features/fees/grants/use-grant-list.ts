"use client";

import { useMemo } from "react";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import type { Page } from "@schoolhub/types";

import { useCursorList } from "@/hooks/use-cursor-list";
import {
  hideableColumnIds,
  useDataGridUrlState,
  type FilterSpec,
} from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";

/** The URL filters every grant list shares: a status ("all" for none) and a student id (`""` for none). */
export interface GrantUrlFilters {
  status: FilterSpec;
  student: FilterSpec;
}

/** What a grant list's read is given: the cursor, the sort and the search and filters in the URL. */
export interface GrantListParams {
  cursor: string | undefined;
  pageSize: number;
  ordering: string | undefined;
  search: string | undefined;
  /** The raw URL value: `"all"` for no status filter. */
  status: string;
  studentId: string | undefined;
}

export interface GrantListConfig<TRecord extends { id: string }> {
  columns: ColumnDef<TRecord>[];
  queryModule: string;
  listResource: string;
  urlFilters: GrantUrlFilters;
  sortField: Record<string, string>;
  defaultSorting: { id: string; desc: boolean }[];
  pageSize: number;
  fetchPage: (params: GrantListParams) => Promise<Page<TRecord>>;
}

/**
 * The shared list read of the Discounts, Scholarships and Fines tabs: URL-held search, status,
 * student and sort, a cursor-paged read, and the table over its rows. A tab keeps only its
 * columns, its read and its copy.
 */
export function useGrantList<TRecord extends { id: string }>(config: GrantListConfig<TRecord>) {
  const { columns, queryModule, listResource, urlFilters, sortField, defaultSorting } = config;
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);
  const sortableIds = useMemo(() => Object.keys(sortField), [sortField]);

  const state = useDataGridUrlState({
    filters: urlFilters,
    sortableIds,
    defaultSorting,
    hideableIds,
    trimSearch: true,
  });
  const { filters, search, sorting } = state;
  const ordering = toOrdering(sorting, sortField);
  const hasActiveFilter = search !== "" || filters.status !== FILTER_ALL || filters.student !== "";

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [search, ordering, filters.status, filters.student].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(queryModule, listResource, { cursor, search, ordering, ...filters }),
    queryFn: (cursor) =>
      config.fetchPage({
        cursor,
        pageSize: config.pageSize,
        ordering,
        search: search || undefined,
        status: filters.status,
        studentId: filters.student || undefined,
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility: state.columnVisibility },
    onSortingChange: state.onSortingChange,
    onColumnVisibilityChange: state.onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return { list, table, state, hasActiveFilter };
}
