import type { ReactNode } from "react";
import { DEFAULT_SKELETON_ROW_COUNT, INTERACTIVE_ELEMENT_SELECTOR } from "../lib/constants";
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
  /**
   * Rendered above the table when the query failed. Optional: a table with an error has
   * nothing to show, but the caller owns the error envelope (`error.code`, `details`) and
   * how it reads, so this is a slot rather than an error object.
   *
   * Before this existed every screen hand-rolled the same `<Alert variant="danger">`
   * block above its own table — three copies of it, and none of them reachable from here.
   */
  error?: ReactNode;
  /**
   * `comfortable` (the default) is today's spacing. `compact` tightens the row height for
   * wide tables — students, staff, allocations — where the reader is scanning down one
   * column rather than reading each row.
   */
  density?: "comfortable" | "compact";
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
  error,
  density = "comfortable",
  onRowClick,
  pagination,
  className,
}: DataTableProps<TRow>) {
  // An error and an empty result are not the same thing, and a table that shows "No
  // students found." when the request actually failed is telling the reader something
  // untrue about their own school.
  const showEmpty = !isLoading && !error && rows.length === 0;
  const cellPadding = density === "compact" ? "py-2" : undefined;

  return (
    <div className={cn("w-full space-y-4", className)}>
      {error}

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
            ? Array.from({ length: DEFAULT_SKELETON_ROW_COUNT }, (_, rowIndex) => (
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
                  // tabIndex as a plain conditional attribute VALUE, not a conditional prop
                  // spread: eslint-plugin-jsx-a11y's static rules
                  // (no-noninteractive-element-interactions and friends) inspect JSX
                  // attributes directly on the element — a spread's contents are opaque to
                  // that analysis, which is exactly how this row's interactivity went
                  // unflagged before. Deliberately NOT role="button": that overrides the
                  // row's implicit "row" role, breaking its ARIA structural relationship
                  // to its own <td> children — a screen reader loses column navigation and
                  // announces every cell's text concatenated as one control instead of
                  // tabular data. tabIndex + the handlers below still make it keyboard-
                  // focusable and activatable without that trade.
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={
                    onRowClick
                      ? (event) => {
                          // A future cell rendering its own <button>/<a> (an actions
                          // column) must not also trigger the row's own click — bail out
                          // if the click originated inside a nested interactive control.
                          if ((event.target as HTMLElement).closest(INTERACTIVE_ELEMENT_SELECTOR))
                            return;
                          onRowClick(row);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if ((event.target as HTMLElement).closest(INTERACTIVE_ELEMENT_SELECTOR))
                            return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <TableCell key={column.id} className={cn(cellPadding, column.className)}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>

      {/* A bare node, not a bespoke dashed box. `emptyState` used to be a string this
          component wrapped in its own styling, which is why every list screen said one
          flat sentence and nothing else. Callers now pass an <EmptyState> — icon,
          heading, what to do next, and the action if they hold the permission — and a
          plain string still renders fine for the tables that genuinely need only that. */}
      {showEmpty ? <div className="text-sm text-muted-foreground">{emptyState}</div> : null}

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
