"use client";

import { Columns3 } from "lucide-react";
import type { DataTableColumn, DataTableColumnVisibility } from "./data-table";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

/**
 * Show and hide a table's columns.
 *
 * Rendered by `DataTable` itself when a `columnVisibility` prop is given, so a caller
 * never has to place it — the control belongs to the table it acts on, and a menu that
 * drifted to the far side of a toolbar would be one more thing to find.
 *
 * `alwaysVisible` columns are not listed. There is no point offering a checkbox that
 * cannot be unticked, and hiding the selection or actions column would leave rows a
 * reader can see and not act on.
 */
export function DataTableColumnsMenu<TRow>({
  columns,
  visibility,
}: {
  columns: DataTableColumn<TRow>[];
  visibility: DataTableColumnVisibility;
}) {
  const hideable = columns.filter((column) => !column.alwaysVisible);
  if (hideable.length === 0) return null;

  const hidden = new Set(visibility.hidden);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" leadingIcon={<Columns3 aria-hidden="true" />}>
          {visibility.triggerLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{visibility.title}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!hidden.has(column.id)}
            // Without this the menu closes on the first tick. Choosing which columns to
            // see is a comparison — you weigh one against the others — so it is almost
            // never a single choice, and reopening the menu between each is the kind of
            // friction that stops people using the feature at all.
            onSelect={(event) => {
              event.preventDefault();
            }}
            onCheckedChange={(checked) => {
              const next = new Set(hidden);
              if (checked) next.delete(column.id);
              else next.add(column.id);
              visibility.onChange([...next]);
            }}
          >
            {/* The header is the column's name everywhere else in the table, so it is
                the name here too. srLabel covers the icon-headed case, where `header`
                is a glyph that would render as an empty menu row. */}
            {column.srLabel ?? column.header}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
