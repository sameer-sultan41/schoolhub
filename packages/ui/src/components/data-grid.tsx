"use client";

/**
 * A TanStack-Table-backed grid — the successor to `data-table.tsx`.
 *
 * `DataTable` (data-table.tsx) is a hand-rolled table: `columns`/`rows` are plain arrays,
 * and there is no table MODEL, only three `.map()` calls that render the same array three
 * times (header, skeleton, body). That is enough for sort + pagination + a flat show/hide
 * menu, but it cannot do column PINNING correctly: pinning a column to an edge means
 * giving it `position: sticky` plus a `left`/`right` offset computed from the pixel widths
 * of every column already pinned before it — arithmetic a table model owns
 * (`column.getStart('left')`/`getAfter('right')`) and a plain array cannot, short of this
 * package re-deriving a table model by hand. `DataGrid` exists because pinning, column
 * reordering (drag or via a menu) and column resizing all need that same model underneath
 * them, and TanStack Table is that model.
 *
 * Ported from a Metronic-based reference (the same one `@linkedunion/dashboard-design-kit`
 * is itself built on) rather than designed from scratch, per this repo's own convention of
 * reusing a proven admin-dashboard pattern instead of inventing one — see AGENTS.md's
 * shadcn-sourcing rule for the same reasoning applied to component sourcing generally.
 * Three departures from that source, every one of them this package's own existing rules
 * applied to new code rather than taste:
 *
 * 1. Every user-facing string is a required prop, bundled into one `labels` object rather
 *    than threaded through every column/pagination/menu prop separately. The reference
 *    hardcodes English in a dozen places ("Loading...", "No data available", "Rows per
 *    page", "Pin to left", "Move to Right", …) — this package has no i18n of its own, so
 *    any default here would always ship untranslated. `DataTableSort` already bundles its
 *    two sort labels the same way; `labels` is that pattern widened to cover pinning,
 *    moving, dragging and the columns menu too, so a column definition itself carries none
 *    of them.
 * 2. Logical direction only. The reference is already mostly there (`border-e`, `-ms-2`,
 *    `ps-2.5`), but a few spots hardcode `left`/`right` (`text-left`, the loader's
 *    `left-1/2`) or lean on an `rtl:` variant where a logical utility already does the job
 *    (`text-left rtl:text-right` is just `text-start`). Every physical utility below is
 *    converted; `pin.tsx`'s own header comment has the one genuine exception (sticky
 *    offsets are physical CSS properties by definition, and are computed with `pinSide`
 *    already resolved to `'start' | 'end'`, not `'left' | 'right'`, before they reach a
 *    style object).
 * 3. No spinner loading mode. The reference offers `loadingMode: 'skeleton' | 'spinner'`;
 *    every real consumer in this repo already uses skeleton rows (`DataTable`'s own
 *    `isLoading` contract), so the spinner branch — and the English "Loading..." string it
 *    would need a label for — is dropped rather than carried over unused.
 */

import { createContext, type ReactNode, useContext } from "react";
import type { RowData, Table } from "@tanstack/react-table";
import { cn } from "../lib/cn";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** The column's name wherever it appears outside its own header cell — the columns
     * menu, a screen-reader-only header, a per-column dropdown's "Columns" submenu.
     * Falls back to the column id, so set this whenever the id is not already the name a
     * reader would recognise. */
    headerTitle?: string;
    headerClassName?: string;
    cellClassName?: string;
    /** What this column shows in a loading row. Defaults to nothing (an empty cell) —
     * worth setting wherever the real cell is not one line of text, exactly as
     * `DataTableColumn.skeleton` already documents. */
    skeleton?: ReactNode;
    /** An expandable row's content for this column's row, keyed by the FIRST column
     * whose meta declares one — see `DataGridTableBodyRowExpanded`. */
    expandedContent?: (row: TData) => ReactNode;
  }
}

/** Every user-facing string a grid instance can possibly need, gathered in one place
 * rather than threaded through pagination/column/menu props individually — the same
 * choice `DataTableSort` already made for its two labels, widened to cover pinning,
 * moving, dragging and the columns menu. Only the labels a grid's `tableLayout` actually
 * turns on are ever read, but all are required so enabling a capability later can never
 * silently ship an untranslated string. */
export interface DataGridLabels {
  sortAscending: (column: string) => string;
  sortDescending: (column: string) => string;
  pinToStart: string;
  pinToEnd: string;
  unpinColumn: (column: string) => string;
  moveToStart: string;
  moveToEnd: string;
  dragToReorderColumn: string;
  dragToReorderRow: string;
  /** Accessible name for a column's resize handle, e.g. "Resize {column} column". A
   * `role="separator"` with no visible text of its own needs one, same as every other
   * icon-only control here. */
  resizeColumn: (column: string) => string;
  columnsMenuLabel: string;
  columnsMenuTitle: string;
  rowsPerPage: string;
  /** Rendered as-is with `{from}`/`{to}`/`{count}` substituted — e.g.
   * `t("pageRange", {from,to,count})` already used by every `DataTable` pagination slot. */
  pageRangeSummary: (range: { from: number; to: number; count: number }) => string;
  previousPage: string;
  nextPage: string;
  goToPage: (page: number) => string;
  morePages: string;
  paginationNav: string;
}

export interface DataGridTableLayout {
  /** Tightens row height for a wide table scanned down one column rather than read row
   * by row — the same job `DataTable`'s `density="compact"` already does. */
  dense?: boolean;
  cellBorder?: boolean;
  /** Alternating row tint, matching `DataTable`'s own `even:bg-surface-sunken` zebra —
   * default `true` so a grid reads the same as every other table in this app unless a
   * caller opts out. */
  stripped?: boolean;
  columnsVisibility?: boolean;
  columnsResizable?: boolean;
  columnsPinnable?: boolean;
  /** Reorder via the per-column dropdown's "Move to start/end" items. */
  columnsMovable?: boolean;
  /** Reorder via a drag handle in each header cell — needs `DataGridTableDnd` in place
   * of the plain `DataGridTable`; see that component's own header. */
  columnsDraggable?: boolean;
  /** Reorder ROWS via a drag handle — needs `DataGridTableDndRows`. Only sensible where
   * row order is itself data (a bell-schedule sequence, a display priority) rather than a
   * server sort/filter result, which is why this defaults to `false` unlike every other
   * flag here. */
  rowsDraggable?: boolean;
}

export interface DataGridProps<TData extends object> {
  className?: string;
  table: Table<TData>;
  /** Total row count across every page — the pagination footer's "of {count}", not
   * `rows.length`, which is only the current page. */
  recordCount: number;
  children?: ReactNode;
  onRowClick?: (row: TData) => void;
  isLoading?: boolean;
  /** A screen-reader-only `<caption>` naming what the grid lists — `DataTable`'s own
   * `caption` prop, carried over rather than dropped: a table with no caption reads to
   * assistive tech as an anonymous grid of cells, and every visible label around it
   * (a page heading, a toolbar) lives outside the `<table>` element itself. */
  caption?: string;
  /** Rendered instead of rows when the loaded result set is empty. `ReactElement`, not
   * `ReactNode` — see `DataTableProps.emptyState`'s own comment for why a bare string is
   * refused at the type level rather than merely discouraged. */
  emptyState: React.ReactElement;
  tableLayout?: DataGridTableLayout;
  labels: DataGridLabels;
}

export interface DataGridContextValue<TData extends object> {
  table: Table<TData>;
  recordCount: number;
  isLoading: boolean;
  onRowClick?: (row: TData) => void;
  emptyState: React.ReactElement;
  tableLayout: Required<DataGridTableLayout>;
  labels: DataGridLabels;
  caption?: string;
}

const DEFAULT_TABLE_LAYOUT: Required<DataGridTableLayout> = {
  dense: false,
  cellBorder: false,
  stripped: true,
  columnsVisibility: false,
  columnsResizable: false,
  columnsPinnable: false,
  columnsMovable: false,
  columnsDraggable: false,
  rowsDraggable: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DataGridContext = createContext<DataGridContextValue<any> | undefined>(undefined);

/** Reads the grid a `DataGridTable*`/`DataGridPagination`/`DataGridColumnHeader` piece is
 * rendered inside. Every one of those throws immediately outside a `DataGrid`, the same
 * contract `useSidebar` already enforces for the same reason: a piece rendered by mistake
 * outside its provider should fail at the call site, not later at a `column.pin is not a
 * function`. */
export function useDataGrid<TData extends object>(): DataGridContextValue<TData> {
  const context = useContext(DataGridContext);
  if (!context) {
    throw new Error("useDataGrid must be used within a DataGrid.");
  }
  return context as DataGridContextValue<TData>;
}

/** The provider every `DataGridTable*`/`DataGridPagination`/`DataGridColumnHeader`/
 * `DataGridColumnVisibility` piece reads from. Holds no table state itself — the caller
 * owns the `useReactTable()` instance (server-side sort/pagination/filters, exactly as
 * `DataTable` already requires the caller to own its TanStack Query) — this only carries
 * it, the loading/empty/layout/labels contract, and the row-click handler to whatever
 * renders inside it. */
export function DataGrid<TData extends object>({
  children,
  table,
  className,
  ...props
}: DataGridProps<TData>) {
  const tableLayout: Required<DataGridTableLayout> = {
    ...DEFAULT_TABLE_LAYOUT,
    ...props.tableLayout,
  };

  return (
    <DataGridContext.Provider
      value={{
        table,
        recordCount: props.recordCount,
        isLoading: props.isLoading ?? false,
        onRowClick: props.onRowClick,
        emptyState: props.emptyState,
        tableLayout,
        labels: props.labels,
        caption: props.caption,
      }}
    >
      {/* One card holds the table and its footer, matching `DataTable`'s own frame — a
          grid is a single object on the page, not a table floating above a separate
          pagination bar. */}
      <div
        data-slot="data-grid"
        className={cn(
          "w-full overflow-hidden rounded-[var(--sh-radius)] border border-border bg-surface",
          className,
        )}
      >
        {children}
      </div>
    </DataGridContext.Provider>
  );
}
