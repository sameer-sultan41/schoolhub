import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Skeleton } from "./skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

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
  /**
   * Rendered instead of rows when the (loaded) result set is empty. Required, not
   * defaulted to an English string — this package has no i18n of its own, so a silent
   * fallback here would always ship untranslated. Callers pass `t("common.noResults")`.
   */
  emptyState: ReactNode;
  onRowClick?: (row: TRow) => void;
  /**
   * Cursor pagination controls (api-architecture.md §2.4). Omit for non-paginated tables.
   * `onNext`/`onPrevious` are disabled automatically when their cursor is null.
   * `nextLabel`/`previousLabel` are required for the same reason as `emptyState`.
   */
  pagination?: {
    hasNext: boolean;
    hasPrevious: boolean;
    onNext: () => void;
    onPrevious: () => void;
    nextLabel: string;
    previousLabel: string;
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
      <Table aria-busy={isLoading || undefined}>
        {caption ? <TableCaption className="sr-only">{caption}</TableCaption> : null}
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.srLabel ? <span className="sr-only">{column.srLabel}</span> : column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 3 }, (_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {columns.map((column) => (
                    <TableCell key={column.id}>
                      <Skeleton className="h-4 w-2/3" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  className={cn(onRowClick && "cursor-pointer hover:bg-muted")}
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
                    <TableCell key={column.id} className={column.className}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>

      {showEmpty ? (
        <div className="rounded-[var(--sh-radius)] border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {emptyState}
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
            {pagination.previousLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={pagination.onNext}
            disabled={!pagination.hasNext || isLoading}
          >
            {pagination.nextLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
