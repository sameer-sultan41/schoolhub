import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export interface DataTableColumn<TRow> {
  /** Stable key, also used as the React key for the cell. */
  id: string;
  header: ReactNode;
  /** Cell renderer. Keep formatting (dates, money) in the caller, not here. */
  cell: (row: TRow) => ReactNode;
  /** Tailwind classes for the cell + header, e.g. "text-end tabular-nums". */
  className?: string;
  /** Column header for screen readers when `header` is an icon. */
  srLabel?: string;
}

export interface DataTableProps<TRow> {
  columns: DataTableColumn<TRow>[];
  rows: TRow[];
  /** Stable row identity — never the array index. */
  getRowId: (row: TRow) => string;
  caption?: string;
  isLoading?: boolean;
  /** Rendered instead of rows when the (loaded) result set is empty. */
  emptyState?: ReactNode;
  onRowClick?: (row: TRow) => void;
  /**
   * Cursor pagination controls (api-architecture.md §2.4). Omit for non-paginated tables.
   * `onNext`/`onPrevious` are disabled automatically when their cursor is null.
   */
  pagination?: {
    hasNext: boolean;
    hasPrevious: boolean;
    onNext: () => void;
    onPrevious: () => void;
    nextLabel?: string;
    previousLabel?: string;
  };
  className?: string;
}

/**
 * Presentational table over an already-fetched page of rows.
 *
 * Deliberately holds no data-fetching logic: the caller owns the TanStack Query
 * (including the cursor) so the same table works for server- and client-fetched data.
 */
export function DataTable<TRow>({
  columns,
  rows,
  getRowId,
  caption,
  isLoading = false,
  emptyState,
  onRowClick,
  pagination,
  className,
}: DataTableProps<TRow>) {
  const showEmpty = !isLoading && rows.length === 0;

  return (
    <div className={cn("w-full space-y-4", className)}>
      <div className="overflow-x-auto rounded-[var(--sh-radius)] border border-border">
        <table className="w-full border-collapse text-sm" aria-busy={isLoading || undefined}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="bg-muted text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn("px-4 py-3 text-start font-medium", column.className)}
                >
                  {column.srLabel ? (
                    <span className="sr-only">{column.srLabel}</span>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 3 }, (_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`} className="border-t border-border">
                    {columns.map((column) => (
                      <td key={column.id} className="px-4 py-3">
                        <span className="block h-4 w-2/3 animate-pulse rounded bg-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={getRowId(row)}
                    className={cn(
                      "border-t border-border",
                      onRowClick && "cursor-pointer hover:bg-muted",
                    )}
                    {...(onRowClick
                      ? {
                          onClick: () => {
                            onRowClick(row);
                          },
                          tabIndex: 0,
                          onKeyDown: (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          },
                        }
                      : {})}
                  >
                    {columns.map((column) => (
                      <td key={column.id} className={cn("px-4 py-3", column.className)}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {showEmpty ? (
        <div className="rounded-[var(--sh-radius)] border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {emptyState ?? "No records found."}
        </div>
      ) : null}

      {pagination ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={pagination.onPrevious}
            disabled={!pagination.hasPrevious || isLoading}
          >
            {pagination.previousLabel ?? "Previous"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={pagination.onNext}
            disabled={!pagination.hasNext || isLoading}
          >
            {pagination.nextLabel ?? "Next"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
