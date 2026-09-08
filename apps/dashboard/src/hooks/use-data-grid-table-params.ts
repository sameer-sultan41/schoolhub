"use client";

import { useMemo } from "react";
import type {
  OnChangeFn,
  PaginationState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { useTableParams, type UseTableParamsOptions } from "@/hooks/use-table-params";

/**
 * `useTableParams`'s URL-backed filters/sort/page/hidden-columns state, reshaped into
 * the `state`/`onXChange` pairs `useReactTable` expects — so a `DataGrid` screen keeps
 * exactly the same shareable-link behaviour `DataTable` screens already have (a
 * filtered, sorted, paged, column-narrowed roster is a link, not a local UI state that
 * resets on refresh) without every screen re-deriving the same three conversions.
 *
 * Column ORDER and PINNING are deliberately NOT here and stay local `useState` in the
 * screen: neither is persisted anywhere in the reference this grid was adapted from
 * either, and putting a viewer's ad hoc column arrangement in a URL a colleague might
 * open on a narrower screen is a different feature from the one this hook's `hidden`
 * param already ships.
 */
export function useDataGridTableParams<TFilter extends string>(
  options: UseTableParamsOptions<TFilter>,
) {
  const table = useTableParams(options);

  const sorting: SortingState = table.sort?.activeKey
    ? [{ id: table.sort.activeKey, desc: table.sort.direction === "desc" }]
    : [];

  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const first = next[0];
    // Clearing the only sort (`column.clearSorting()`) reports `[]` — there is nothing
    // in this app's URL vocabulary for "no sort, but remember what it was", so it maps
    // to the same "no sort_by param" state a fresh visit starts in.
    table.sort?.onChange(first?.id ?? "", first?.desc ? "desc" : "asc");
  };

  const pagination: PaginationState = useMemo(
    () => ({ pageIndex: table.page - 1, pageSize: table.pageSize }),
    [table.page, table.pageSize],
  );

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === "function" ? updater(pagination) : updater;
    if (next.pageSize !== pagination.pageSize) {
      // Changing the size already sends the URL back to page 1 (see useTableParams'
      // own `resetPage` reasoning) — a page-index update in the same gesture would
      // fight it, so it is intentionally dropped here.
      table.setPageSize(next.pageSize);
    } else if (next.pageIndex !== pagination.pageIndex) {
      table.setPage(next.pageIndex + 1);
    }
  };

  const columnVisibility: VisibilityState = useMemo(
    () => Object.fromEntries(table.hiddenColumns.map((id) => [id, false])),
    [table.hiddenColumns],
  );

  const onColumnVisibilityChange: OnChangeFn<VisibilityState> = (updater) => {
    const next = typeof updater === "function" ? updater(columnVisibility) : updater;
    table.setHiddenColumns(
      Object.entries(next)
        .filter(([, visible]) => !visible)
        .map(([id]) => id),
    );
  };

  return {
    ...table,
    sorting,
    onSortingChange,
    pagination,
    onPaginationChange,
    columnVisibility,
    onColumnVisibilityChange,
  };
}
