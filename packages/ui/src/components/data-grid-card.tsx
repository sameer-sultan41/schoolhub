"use client";

/**
 * The composition every `DataGrid` screen wants — a toolbar row, the table, and a
 * pagination footer, in one card — mirroring `DataTable`'s own shape exactly (same
 * border/rounding, same toolbar-row-then-error-slot-then-table-then-footer order) so a
 * screen migrating from `DataTable` changes its column definitions and its table state,
 * not the page around it.
 *
 * A caller wanting the plain `DataGridTable` needs nothing beyond this; one wanting
 * `DataGridTableDnd` (draggable columns) passes `onColumnDragEnd`, since that is the one
 * piece of wiring `DataGrid`'s own generic children slot cannot infer on its own.
 */

import type { ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { DataGrid, type DataGridProps } from "./data-grid";
import { DataGridColumnVisibility } from "./data-grid-column-visibility";
import { DataGridTableDnd } from "./data-grid-dnd";
import { DataGridPagination } from "./data-grid-pagination";
import { DataGridTable } from "./data-grid-table";

export interface DataGridCardProps<TData extends object> extends DataGridProps<TData> {
  /** The filter row — a `FilterBar`, typically. A slot for the same reason `DataTable`'s
   * own `toolbar` is: this package does not know the app's filter component. */
  toolbar?: ReactNode;
  /** Rendered between the toolbar and the table when the query failed — same placement
   * `DataTable.error` uses, so the filter row stays usable while a failed request under
   * a narrow filter can be widened without a reload. */
  error?: ReactNode;
  /** Rows-per-page options for the footer. Omit to use `DataGridPagination`'s own
   * default; pass `[]` to hide the control entirely. */
  pageSizes?: number[];
  /** Wires `DataGridTableDnd` in place of the plain `DataGridTable` — only meaningful
   * alongside `tableLayout.columnsDraggable`. */
  onColumnDragEnd?: (event: DragEndEvent) => void;
}

export function DataGridCard<TData extends object>({
  toolbar,
  error,
  pageSizes,
  onColumnDragEnd,
  className,
  ...gridProps
}: DataGridCardProps<TData>) {
  const columnsMenu = gridProps.tableLayout?.columnsVisibility ? (
    <DataGridColumnVisibility />
  ) : null;
  const hasToolbar = Boolean(toolbar) || columnsMenu !== null;

  return (
    <DataGrid {...gridProps} className={className}>
      {hasToolbar ? (
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {columnsMenu}
        </div>
      ) : null}

      {error ? <div className="border-b border-border p-4">{error}</div> : null}

      <div className="overflow-x-auto">
        {gridProps.tableLayout?.columnsDraggable && onColumnDragEnd ? (
          <DataGridTableDnd onDragEnd={onColumnDragEnd} />
        ) : (
          <DataGridTable />
        )}
      </div>

      <DataGridPagination {...(pageSizes ? { sizes: pageSizes } : {})} />
    </DataGrid>
  );
}
