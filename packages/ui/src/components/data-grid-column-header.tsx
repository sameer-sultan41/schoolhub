"use client";

/**
 * A sortable, pinnable, moveable column header, gathered into one dropdown rather than
 * one control each — the reference this was adapted from puts sort/pin/move/visibility
 * behind a single button for the same reason a header row is already crowded: five
 * separate icon buttons per column does not fit, and a reader only ever wants one of
 * these at a time anyway.
 *
 * Renders progressively less as fewer capabilities apply — a plain label if the column
 * can do none of sort/pin/move/hide, a bare sort button if it can only sort, the full
 * dropdown otherwise — so a column that opts out of everything costs nothing, and a
 * caller filling in `header` for every column never has to branch on which case applies.
 */

import type { ReactNode } from "react";
import type { Column, Table } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  Check,
  ChevronsUpDown,
  PinOff,
  Settings2,
} from "lucide-react";
import { useDataGrid } from "./data-grid";
import { pinnedSide } from "../lib/pin-side";
import { cn } from "../lib/cn";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface DataGridColumnHeaderProps<TData extends object> {
  column: Column<TData>;
  title: string;
  icon?: ReactNode;
  className?: string;
}

/** Where a moved column belongs for "start"/"end" — the edge of the UNPINNED region,
 * not the absolute array edge. This menu item is disabled for a pinned column (see its
 * `disabled={... || side !== false}` below), so the column being placed is always
 * unpinned; "start" means right after the last pinned-start column and "end" means
 * right before the first pinned-end one. A left-pinned column has to stay in DOM order
 * before every unpinned column, and a right-pinned one after, or the sticky offset math
 * (computed from the pinning order, not `columnOrder` — see `column.getStart('left')`
 * in `getPinningStyles`) stops matching where the column actually renders, and cells
 * overlap on scroll.
 *
 * `columnIds` is the order WITHOUT the moved column already removed from it, so the
 * returned index is where to `splice` it back in directly. */
function unpinnedRegionEdge(
  columnIds: readonly string[],
  pinnedStart: ReadonlySet<string>,
  pinnedEnd: ReadonlySet<string>,
  direction: "start" | "end",
): number {
  if (direction === "start") {
    const index = columnIds.findIndex((id) => !pinnedStart.has(id));
    return index === -1 ? columnIds.length : index;
  }
  const index = columnIds.findIndex((id) => pinnedEnd.has(id));
  return index === -1 ? columnIds.length : index;
}

/** `Column` carries no reference back to its `Table` — both take the table explicitly
 * rather than reading it off the column, unlike `column.pin()`/`column.toggleSorting()`,
 * which the column's own feature mixins do provide. */
function moveColumn<TData>(
  table: Table<TData>,
  columnId: string,
  direction: "start" | "end",
): void {
  const { columnOrder, columnPinning } = table.getState();
  const pinnedStart = new Set(columnPinning.left);
  const pinnedEnd = new Set(columnPinning.right);
  const withoutMoved = columnOrder.filter((id) => id !== columnId);
  const target = unpinnedRegionEdge(withoutMoved, pinnedStart, pinnedEnd, direction);

  const next = [...withoutMoved];
  next.splice(target, 0, columnId);
  table.setColumnOrder(next);
}

function canMove<TData>(
  table: Table<TData>,
  columnId: string,
  direction: "start" | "end",
): boolean {
  const { columnOrder, columnPinning } = table.getState();
  const currentIndex = columnOrder.indexOf(columnId);
  if (currentIndex === -1) return false;

  const pinnedStart = new Set(columnPinning.left);
  const pinnedEnd = new Set(columnPinning.right);
  const withoutMoved = columnOrder.filter((id) => id !== columnId);
  const target = unpinnedRegionEdge(withoutMoved, pinnedStart, pinnedEnd, direction);
  // Removing `columnId` only shifts indices AFTER its own position, and `target` is
  // computed on that post-removal array — so `target === currentIndex` means putting
  // it back exactly where it already sits (nothing to do), and anywhere else means the
  // edge of the unpinned region is actually somewhere new.
  return target !== currentIndex;
}

export function DataGridColumnHeader<TData extends object>({
  column,
  title,
  icon,
  className,
}: DataGridColumnHeaderProps<TData>) {
  const { table, isLoading, recordCount, tableLayout, labels } = useDataGrid<TData>();
  const side = pinnedSide(column.getIsPinned());

  const label = (
    <span
      className={cn(
        "inline-flex h-full items-center gap-1.5 font-normal text-muted-foreground",
        className,
      )}
    >
      {icon}
      {title}
    </span>
  );

  const sortToggle = (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ms-2 h-7 gap-1 px-2 font-normal text-foreground", className)}
      disabled={isLoading || recordCount === 0}
      onClick={() => {
        const sorted = column.getIsSorted();
        if (sorted === "asc") column.toggleSorting(true);
        else if (sorted === "desc") column.clearSorting();
        else column.toggleSorting(false);
      }}
    >
      {icon}
      {title}
      {column.getCanSort() &&
        (column.getIsSorted() === "desc" ? (
          <ArrowDown aria-hidden="true" className="size-3.5" />
        ) : column.getIsSorted() === "asc" ? (
          <ArrowUp aria-hidden="true" className="size-3.5" />
        ) : (
          <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-50" />
        ))}
    </Button>
  );

  const canPin = tableLayout.columnsPinnable && column.getCanPin();
  const canMoveColumn = tableLayout.columnsMovable;
  const canToggleVisibility = tableLayout.columnsVisibility;
  const needsDropdown = column.getCanSort() || canPin || canMoveColumn || canToggleVisibility;

  if (!needsDropdown) return label;
  if (!canPin && !canMoveColumn && !canToggleVisibility) return sortToggle;

  return (
    <div className="flex h-full items-center justify-between gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {column.getCanSort() ? sortToggle : label}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          {column.getCanSort() && (
            <>
              <DropdownMenuItem
                onClick={() => {
                  if (column.getIsSorted() === "asc") column.clearSorting();
                  else column.toggleSorting(false);
                }}
              >
                <ArrowUp aria-hidden="true" className="size-3.5" />
                <span className="grow">{labels.sortAscending(title)}</span>
                {column.getIsSorted() === "asc" && (
                  <Check aria-hidden="true" className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (column.getIsSorted() === "desc") column.clearSorting();
                  else column.toggleSorting(true);
                }}
              >
                <ArrowDown aria-hidden="true" className="size-3.5" />
                <span className="grow">{labels.sortDescending(title)}</span>
                {column.getIsSorted() === "desc" && (
                  <Check aria-hidden="true" className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
            </>
          )}

          {column.getCanSort() && (canPin || canMoveColumn || canToggleVisibility) && (
            <DropdownMenuSeparator />
          )}

          {canPin && (
            <>
              <DropdownMenuItem
                onClick={() => {
                  column.pin(side === "start" ? false : "left");
                }}
              >
                <ArrowLeftToLine aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
                <span className="grow">{labels.pinToStart}</span>
                {side === "start" && <Check aria-hidden="true" className="size-4 text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  column.pin(side === "end" ? false : "right");
                }}
              >
                <ArrowRightToLine aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
                <span className="grow">{labels.pinToEnd}</span>
                {side === "end" && <Check aria-hidden="true" className="size-4 text-primary" />}
              </DropdownMenuItem>
            </>
          )}

          {canMoveColumn && (
            <>
              {canPin && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onClick={() => {
                  moveColumn(table, column.id, "start");
                }}
                disabled={!canMove(table, column.id, "start") || side !== false}
              >
                <ArrowLeftToLine aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
                <span>{labels.moveToStart}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  moveColumn(table, column.id, "end");
                }}
                disabled={!canMove(table, column.id, "end") || side !== false}
              >
                <ArrowRightToLine aria-hidden="true" className="size-3.5 rtl:-scale-x-100" />
                <span>{labels.moveToEnd}</span>
              </DropdownMenuItem>
            </>
          )}

          {canToggleVisibility && (canPin || canMoveColumn || column.getCanSort()) && (
            <DropdownMenuSeparator />
          )}

          {canToggleVisibility && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Settings2 aria-hidden="true" className="size-3.5" />
                <span>{labels.columnsMenuLabel}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {table
                  .getAllColumns()
                  .filter((col) => col.getCanHide())
                  .map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.id}
                      checked={col.getIsVisible()}
                      onSelect={(event) => {
                        event.preventDefault();
                      }}
                      onCheckedChange={(value) => {
                        col.toggleVisibility(value);
                      }}
                    >
                      {col.columnDef.meta?.headerTitle ?? col.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canPin && side !== false && (
        <Button
          variant="ghost"
          size="icon"
          className="-me-1 size-7"
          onClick={() => {
            column.pin(false);
          }}
          aria-label={labels.unpinColumn(title)}
          title={labels.unpinColumn(title)}
        >
          <PinOff aria-hidden="true" className="size-3.5 opacity-60" />
        </Button>
      )}
    </div>
  );
}
