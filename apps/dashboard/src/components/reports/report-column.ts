import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";

/** A report table's plain column: a translated header and a cell. Report columns are never
 * sorted (the table keeps the server's order). */
export function reportColumn<TRow>(
  id: string,
  title: string,
  cell: (row: TRow) => ReactNode,
): ColumnDef<TRow> {
  return {
    id,
    enableSorting: false,
    header: () => title,
    cell: ({ row }) => cell(row.original),
    meta: { headerTitle: title },
  };
}
