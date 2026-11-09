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
import { toOrdering } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";

/** What a collection list's read is given: the cursor, page size, sort and the URL filters as raw strings. */
export interface CollectionListParams<F extends string> {
  cursor: string | undefined;
  pageSize: number;
  ordering: string | undefined;
  /** The search box's text, written to the URL after a pause; `""` for none (a tab without a box never sets it). */
  search: string;
  /** The raw URL values, each at its default when unset (`"all"`, `""`). */
  filters: Record<F, string>;
}

export interface CollectionListConfig<TRecord extends { id: string }, F extends string> {
  columns: ColumnDef<TRecord>[];
  queryModule: string;
  listResource: string;
  urlFilters: Record<F, FilterSpec>;
  sortField: Record<string, string>;
  defaultSorting: { id: string; desc: boolean }[];
  pageSize: number;
  fetchPage: (params: CollectionListParams<F>) => Promise<Page<TRecord>>;
  /** Extra values the read depends on beyond the URL (the viewer's id behind "my collections"). */
  keyExtras?: readonly string[];
}

/**
 * The cursor-paged list read behind the Payments, Receipts, Vouchers, Refunds and Settlement
 * imports tabs: URL-held search, filters and sort (`useDataGridUrlState`), a cursor read that
 * starts over on any change, and the table over its rows. A tab keeps only its columns, its read
 * and its filter controls. `hasActiveFilter` is whether the search or any URL filter differs from its default.
 */
export function useCollectionList<TRecord extends { id: string }, F extends string>(
  config: CollectionListConfig<TRecord, F>,
) {
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
  const extras = config.keyExtras ?? [];
  const hasActiveFilter =
    search !== "" ||
    (Object.keys(urlFilters) as F[]).some((key) => filters[key] !== urlFilters[key].default);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [search, ordering, ...Object.values<string>(filters), ...extras].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(queryModule, listResource, { cursor, search, ordering, ...filters, extras }),
    queryFn: (cursor) =>
      config.fetchPage({ cursor, pageSize: config.pageSize, ordering, search, filters }),
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
