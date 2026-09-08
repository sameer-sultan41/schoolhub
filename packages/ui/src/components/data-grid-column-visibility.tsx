"use client";

/**
 * The toolbar-level twin of `DataGridColumnHeader`'s own "Columns" submenu — this is the
 * one a caller places once, in the grid's toolbar, rather than needing to open any one
 * column's dropdown to reach it. Both read and write the exact same TanStack column-
 * visibility state, so toggling a column here or from its own header agree instantly.
 */

import { Columns3 } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { useDataGrid } from "./data-grid";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

/** Whether this grid has anything for the columns menu to show — `DataGridColumnVisibility`
 * itself renders `null` when it doesn't, but a CALLER deciding whether to render the
 * toolbar row AROUND it (`DataGridCard`) needs to know that ahead of the JSX existing,
 * not after: a JSX element is truthy regardless of what its component renders. One
 * predicate, used by both, so the two can never disagree. */
export function hasHideableColumns<TData>(table: Table<TData>): boolean {
  return table.getAllColumns().some((column) => column.getCanHide());
}

export function DataGridColumnVisibility() {
  const { table, labels } = useDataGrid();
  const hideable = table.getAllColumns().filter((column) => column.getCanHide());
  if (hideable.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* No explicit `size` — Button's own default ("md", h-10) is what makes this
            match the toolbar's `Input`/`Select` beside it, both h-10 themselves. `sm`
            (h-8) made this the one short control in an otherwise even row. */}
        <Button variant="outline" leadingIcon={<Columns3 aria-hidden="true" />}>
          {labels.columnsMenuLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{labels.columnsMenuTitle}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            onSelect={(event) => {
              event.preventDefault();
            }}
            onCheckedChange={(value) => {
              column.toggleVisibility(value);
            }}
          >
            {column.columnDef.meta?.headerTitle ?? column.id}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
