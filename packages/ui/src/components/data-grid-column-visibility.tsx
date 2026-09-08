"use client";

/**
 * The toolbar-level twin of `DataGridColumnHeader`'s own "Columns" submenu — this is the
 * one a caller places once, in the grid's toolbar, rather than needing to open any one
 * column's dropdown to reach it. Both read and write the exact same TanStack column-
 * visibility state, so toggling a column here or from its own header agree instantly.
 */

import { Columns3 } from "lucide-react";
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

export function DataGridColumnVisibility() {
  const { table, labels } = useDataGrid();
  const hideable = table.getAllColumns().filter((column) => column.getCanHide());
  if (hideable.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" leadingIcon={<Columns3 aria-hidden="true" />}>
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
