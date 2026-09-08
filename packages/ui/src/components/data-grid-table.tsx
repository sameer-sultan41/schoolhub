"use client";

/**
 * The rendering primitives `DataGridTable` (the plain grid) and `DataGridTableDnd`/
 * `DataGridTableDndRows` (data-grid-dnd.tsx) all share — headers, sticky/pinned cells,
 * skeleton rows, the empty state. Deliberately a SEPARATE set of primitives from
 * `table.tsx`'s plain `Table`/`TableRow`/`TableCell`: those exist for a table that is
 * just markup, and a pinned cell's `data-pinned` attribute, computed sticky offset and
 * resize handle have nowhere to attach on them without threading grid-only concerns
 * through a component every non-grid table also uses.
 *
 * Pinning is rendered with LOGICAL inset properties (`insetInlineStart`/`-End`), not
 * `left`/`right` — `position: sticky` respects them exactly as it respects the physical
 * ones, in every browser this repo supports, so a column "pinned to the start" sticks to
 * the reading-direction-leading edge in both `en` (left) and `ur` (right) with no
 * direction check anywhere in this file. TanStack Table's own pinning API only knows
 * `'left' | 'right'` — this package's public surface never says so; see `pin-side.ts`
 * for the one place that translation happens.
 */

import * as React from "react";
import { type CSSProperties, Fragment, type ReactNode } from "react";
import {
  type Cell,
  type Column,
  flexRender,
  type Header,
  type HeaderGroup,
  type Row,
} from "@tanstack/react-table";
import { useDataGrid } from "./data-grid";
import { pinnedSide } from "../lib/pin-side";
import { INTERACTIVE_ELEMENT_SELECTOR } from "../lib/constants";
import { cn } from "../lib/cn";
import { Checkbox } from "./checkbox";

function getPinningStyles<TData>(column: Column<TData>): CSSProperties {
  const side = pinnedSide(column.getIsPinned());
  return {
    insetInlineStart: side === "start" ? `${column.getStart("left")}px` : undefined,
    insetInlineEnd: side === "end" ? `${column.getAfter("right")}px` : undefined,
    position: side ? "sticky" : "relative",
    width: column.getSize(),
    zIndex: side ? 1 : 0,
  };
}

/** The shared class fragment that gives a pinned header/body cell its border and its
 * "content scrolling under a sticky column must not show through" backing — a plain
 * `bg-*` would still let a lower-opacity ancestor bleed through at the edge, which is
 * why both carry a blur alongside the tint, exactly as the reference this was adapted
 * from does with its own `backdrop-blur-xs`. */
const PINNED_HEADER_CELL =
  "data-pinned:border-border data-pinned:bg-muted/95 data-pinned:backdrop-blur-xs data-[pinned=start][data-last-col=start]:border-e! data-[pinned=end][data-last-col=end]:border-s!";
const PINNED_BODY_CELL =
  "data-pinned:border-border data-pinned:bg-surface/95 data-pinned:backdrop-blur-xs data-[pinned=start][data-last-col=start]:border-e! data-[pinned=end][data-last-col=end]:border-s!";

function DataGridTableBase({ children }: { children: ReactNode }) {
  const { tableLayout, caption, isLoading } = useDataGrid();
  return (
    <table
      data-slot="data-grid-table"
      aria-busy={isLoading || undefined}
      className={cn(
        "w-full border-separate border-spacing-0 text-start align-middle text-sm text-foreground",
        tableLayout.columnsResizable ? "table-fixed" : "table-auto",
      )}
    >
      {/* `<caption>` must be the table's first child per the HTML spec — a `<table>` with
          no visible label of its own around it (this one sits inside a plain `<div>`
          card, not a `<section aria-labelledby>`), so screen-reader users get a name for
          the grid instead of an anonymous "table" landmark. */}
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  );
}

function DataGridTableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-muted text-muted-foreground">{children}</thead>;
}

function DataGridTableHeadRow<TData>({
  children,
  headerGroup: _headerGroup,
}: {
  children: ReactNode;
  headerGroup: HeaderGroup<TData>;
}) {
  return <tr className="[&>th]:border-b [&>th]:border-border">{children}</tr>;
}

function DataGridTableHeadRowCell<TData>({
  children,
  header,
  dndRef,
  dndStyle,
}: {
  children: ReactNode;
  header: Header<TData, unknown>;
  dndRef?: React.Ref<HTMLTableCellElement>;
  dndStyle?: CSSProperties;
}) {
  const { tableLayout } = useDataGrid();
  const { column } = header;
  const side = pinnedSide(column.getIsPinned());
  const isLastStartPinned = side === "start" && column.getIsLastColumn("left");
  const isFirstEndPinned = side === "end" && column.getIsFirstColumn("right");

  return (
    <th
      ref={dndRef}
      scope="col"
      style={{
        ...(tableLayout.columnsResizable ? { width: header.getSize() } : null),
        ...(tableLayout.columnsPinnable && column.getCanPin() ? getPinningStyles(column) : null),
        ...dndStyle,
      }}
      data-pinned={side || undefined}
      data-last-col={isLastStartPinned ? "start" : isFirstEndPinned ? "end" : undefined}
      className={cn(
        "relative h-10 text-start align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pe-0",
        tableLayout.dense ? "px-2.5" : "px-4",
        tableLayout.cellBorder && "border-e border-border",
        tableLayout.columnsPinnable && column.getCanPin() && PINNED_HEADER_CELL,
        header.column.columnDef.meta?.headerClassName,
      )}
    >
      {children}
    </th>
  );
}

/** A resize step for the keyboard alternative below — the same 10px a reader dragging the
 * handle would nudge it by in one small mouse movement. */
const RESIZE_KEYBOARD_STEP = 10;

/** A drag handle for `header.getResizeHandler()`, offset to the END edge with a logical
 * inset so the grab target sits on the visual border regardless of direction.
 *
 * `role="separator"` plus arrow-key resizing and Home-to-reset are the "appropriate role
 * and support for tabbing, mouse, keyboard, and touch inputs" a non-native draggable div
 * needs (WCAG 2.1.1) — mouse/touch alone would leave a reader who cannot drag with no way
 * to resize the column at all. Left/Right narrow/widen regardless of `dir`, matching how a
 * native `<input type=range>` keeps Left=decrease/Right=increase under RTL too (per the
 * HTML spec) rather than mirroring — a size is a magnitude, not a reading-direction
 * position, so there is no "start/end" sense for it the way pinning has one.
 */
function DataGridTableHeadRowCellResize<TData>({ header }: { header: Header<TData, unknown> }) {
  const { labels } = useDataGrid();
  const { column } = header;
  const title = column.columnDef.meta?.headerTitle ?? column.id;
  const min = column.columnDef.minSize ?? 20;
  const max = column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;

  function resizeBy(delta: number) {
    const next = Math.min(max, Math.max(min, column.getSize() + delta));
    header.getContext().table.setColumnSizing((sizing) => ({ ...sizing, [column.id]: next }));
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- WAI-ARIA APG's own separator pattern (https://www.w3.org/WAI/ARIA/apg/patterns/separator/) makes a MOVABLE separator focusable and interactive by design; jsx-a11y's static role list doesn't special-case that.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={labels.resizeColumn(title)}
      aria-valuenow={column.getSize()}
      aria-valuemin={min}
      aria-valuemax={max === Number.MAX_SAFE_INTEGER ? undefined : max}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- same movable-separator exception as above; this attribute's own violation is reported here, not on the element's opening line.
      tabIndex={0}
      onDoubleClick={() => {
        column.resetSize();
      }}
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          resizeBy(-RESIZE_KEYBOARD_STEP);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          resizeBy(RESIZE_KEYBOARD_STEP);
        } else if (event.key === "Home") {
          event.preventDefault();
          column.resetSize();
        }
      }}
      className="absolute inset-y-0 end-0 z-10 flex w-4 -translate-x-1/2 cursor-col-resize touch-none justify-center before:absolute before:inset-y-0 before:start-1/2 before:w-px before:-translate-x-px before:bg-border rtl:translate-x-1/2"
    />
  );
}

function DataGridTableRowSpacer() {
  return <tbody aria-hidden="true" className="h-2" />;
}

function DataGridTableBody({ children }: { children: ReactNode }) {
  return <tbody className="[&_tr:last-child]:border-0">{children}</tbody>;
}

function rowShellClassName(tableLayout: { stripped: boolean }, hasClick: boolean): string {
  return cn(
    "hover:bg-muted data-[state=selected]:bg-muted",
    hasClick && "cursor-pointer",
    tableLayout.stripped && "even:bg-surface-sunken",
    "[&:not(:last-child)>td]:border-b [&:not(:last-child)>td]:border-border",
  );
}

function DataGridTableBodyRowSkeleton({ children }: { children: ReactNode }) {
  const { tableLayout, onRowClick } = useDataGrid();
  return <tr className={rowShellClassName(tableLayout, Boolean(onRowClick))}>{children}</tr>;
}

function DataGridTableBodyRowSkeletonCell<TData>({
  children,
  column,
}: {
  children: ReactNode;
  column: Column<TData>;
}) {
  const { tableLayout } = useDataGrid();
  return (
    <td
      className={cn(
        "align-middle",
        tableLayout.dense ? "px-2.5 py-2" : "px-4 py-3",
        tableLayout.cellBorder && "border-e border-border",
        column.columnDef.meta?.cellClassName,
      )}
    >
      {children}
    </td>
  );
}

function DataGridTableBodyRow<TData extends object>({
  children,
  row,
  dndRef,
  dndStyle,
}: {
  children: ReactNode;
  row: Row<TData>;
  dndRef?: React.Ref<HTMLTableRowElement>;
  dndStyle?: CSSProperties;
}) {
  const { tableLayout, onRowClick } = useDataGrid();
  // A click or keypress that originated in the row's own select checkbox (a real
  // `<button role="checkbox">`, per Radix) must not also open the row — same guard
  // `INTERACTIVE_ELEMENT_SELECTOR` gives the old `DataTable`'s clickable rows, matching
  // its keyboard support (tabIndex + Enter/Space) too rather than mouse-only.
  function isFromInteractiveElement(event: React.SyntheticEvent): boolean {
    return Boolean((event.target as HTMLElement).closest(INTERACTIVE_ELEMENT_SELECTOR));
  }

  return (
    <tr
      ref={dndRef}
      style={dndStyle}
      data-state={row.getIsSelected() ? "selected" : undefined}
      tabIndex={onRowClick ? 0 : undefined}
      onClick={
        onRowClick
          ? (event) => {
              if (isFromInteractiveElement(event)) return;
              onRowClick(row.original);
            }
          : undefined
      }
      onKeyDown={
        onRowClick
          ? (event) => {
              if (isFromInteractiveElement(event)) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onRowClick(row.original);
              }
            }
          : undefined
      }
      className={rowShellClassName(tableLayout, Boolean(onRowClick))}
    >
      {children}
    </tr>
  );
}

function DataGridTableBodyRowExpanded<TData extends object>({ row }: { row: Row<TData> }) {
  const { table } = useDataGrid<TData>();
  const expandable = table.getAllColumns().find((column) => column.columnDef.meta?.expandedContent);

  return (
    <tr className="[&:not(:last-child)>td]:border-b [&:not(:last-child)>td]:border-border">
      <td colSpan={row.getVisibleCells().length}>
        {expandable?.columnDef.meta?.expandedContent?.(row.original)}
      </td>
    </tr>
  );
}

function DataGridTableBodyRowCell<TData>({
  children,
  cell,
  dndRef,
  dndStyle,
}: {
  children: ReactNode;
  cell: Cell<TData, unknown>;
  dndRef?: React.Ref<HTMLTableCellElement>;
  dndStyle?: CSSProperties;
}) {
  const { tableLayout } = useDataGrid();
  const { column } = cell;
  const side = pinnedSide(column.getIsPinned());
  const isLastStartPinned = side === "start" && column.getIsLastColumn("left");
  const isFirstEndPinned = side === "end" && column.getIsFirstColumn("right");

  return (
    <td
      ref={dndRef}
      style={{
        ...(tableLayout.columnsPinnable && column.getCanPin() ? getPinningStyles(column) : null),
        ...dndStyle,
      }}
      data-pinned={side || undefined}
      data-last-col={isLastStartPinned ? "start" : isFirstEndPinned ? "end" : undefined}
      className={cn(
        "align-middle",
        tableLayout.dense ? "px-2.5 py-2" : "px-4 py-3",
        tableLayout.cellBorder && "border-e border-border",
        tableLayout.columnsPinnable && column.getCanPin() && PINNED_BODY_CELL,
        cell.column.columnDef.meta?.cellClassName,
      )}
    >
      {children}
    </td>
  );
}

function DataGridTableEmpty() {
  const { table, emptyState } = useDataGrid();
  return (
    <tr>
      <td colSpan={table.getAllColumns().length} className="p-4">
        {emptyState}
      </td>
    </tr>
  );
}

/** `<Checkbox>` already requires `label` — see checkbox.tsx's own header for why a
 * table-cell checkbox has no visible `<Label>` to borrow a name from. Neither wraps
 * itself in a click-swallowing div: `Checkbox` renders a real `<button role="checkbox">`,
 * which `DataGridTableBodyRow`'s own `INTERACTIVE_ELEMENT_SELECTOR` guard already excuses
 * from the row's `onRowClick` — the same guard the old `DataTable` used, rather than
 * pattern-matching the event target after the fact with a wrapper. */
function DataGridTableRowSelect<TData>({ row, label }: { row: Row<TData>; label: string }) {
  return (
    <Checkbox
      label={label}
      checked={row.getIsSelected()}
      // `Checkbox` (checkbox.tsx) is a real tri-state control — its `onCheckedChange` can
      // report `"indeterminate"`, unlike `DropdownMenuCheckboxItem`'s own plain boolean —
      // so unlike that dropdown item's handler, this compare is load-bearing, not redundant.
      onCheckedChange={(value) => {
        row.toggleSelected(value === true);
      }}
    />
  );
}

function DataGridTableRowSelectAll({ label }: { label: string }) {
  const { table, recordCount, isLoading } = useDataGrid();
  return (
    <Checkbox
      label={label}
      checked={
        table.getIsAllPageRowsSelected()
          ? true
          : table.getIsSomePageRowsSelected()
            ? "indeterminate"
            : false
      }
      disabled={isLoading || recordCount === 0}
      onCheckedChange={(value) => {
        table.toggleAllPageRowsSelected(value === true);
      }}
    />
  );
}

/** A column factory, not a component — matches every other column in a `ColumnDef<TData>`
 * array rather than needing special-case wiring. `enableHiding: false` because a roster
 * whose checkboxes are gone can be looked at and not acted on; `enableSorting`/
 * `enablePinning: false` because a selection column has no data to sort or pin by. */
export function createSelectColumn<TData>(labels: {
  selectAll: string;
  selectRow: string;
  skeleton?: ReactNode;
}) {
  return {
    id: "select",
    header: () => <DataGridTableRowSelectAll label={labels.selectAll} />,
    cell: ({ row }: { row: Row<TData> }) => (
      <DataGridTableRowSelect row={row} label={labels.selectRow} />
    ),
    enableSorting: false,
    enableHiding: false,
    enablePinning: false,
    enableResizing: false,
    size: 40,
    meta: {
      headerClassName: "w-10",
      cellClassName: "w-10",
      skeleton: labels.skeleton,
      draggable: false,
    },
  };
}

function DataGridTable() {
  const { table, isLoading, tableLayout } = useDataGrid();
  const pageSize = table.getState().pagination.pageSize;

  return (
    <DataGridTableBase>
      <DataGridTableHead>
        {table.getHeaderGroups().map((headerGroup) => (
          <DataGridTableHeadRow headerGroup={headerGroup} key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const { column } = header;
              return (
                <DataGridTableHeadRowCell header={header} key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                  {tableLayout.columnsResizable && column.getCanResize() && (
                    <DataGridTableHeadRowCellResize header={header} />
                  )}
                </DataGridTableHeadRowCell>
              );
            })}
          </DataGridTableHeadRow>
        ))}
      </DataGridTableHead>

      {!tableLayout.stripped && <DataGridTableRowSpacer />}

      <DataGridTableBody>
        {isLoading ? (
          Array.from({ length: pageSize }, (_, rowIndex) => (
            <DataGridTableBodyRowSkeleton key={rowIndex}>
              {table.getVisibleFlatColumns().map((column) => (
                <DataGridTableBodyRowSkeletonCell column={column} key={column.id}>
                  {column.columnDef.meta?.skeleton}
                </DataGridTableBodyRowSkeletonCell>
              ))}
            </DataGridTableBodyRowSkeleton>
          ))
        ) : table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <DataGridTableBodyRow row={row}>
                {row.getVisibleCells().map((cell) => (
                  <DataGridTableBodyRowCell cell={cell} key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </DataGridTableBodyRowCell>
                ))}
              </DataGridTableBodyRow>
              {row.getIsExpanded() && <DataGridTableBodyRowExpanded row={row} />}
            </Fragment>
          ))
        ) : (
          <DataGridTableEmpty />
        )}
      </DataGridTableBody>
    </DataGridTableBase>
  );
}

export {
  DataGridTable,
  DataGridTableBase,
  DataGridTableBody,
  DataGridTableBodyRow,
  DataGridTableBodyRowCell,
  DataGridTableBodyRowExpanded,
  DataGridTableBodyRowSkeleton,
  DataGridTableBodyRowSkeletonCell,
  DataGridTableEmpty,
  DataGridTableHead,
  DataGridTableHeadRow,
  DataGridTableHeadRowCell,
  DataGridTableHeadRowCellResize,
  DataGridTableRowSelect,
  DataGridTableRowSelectAll,
  DataGridTableRowSpacer,
  getPinningStyles,
};
