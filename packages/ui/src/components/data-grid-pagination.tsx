"use client";

/**
 * The grid's footer: a rows-per-page select, the "{from}–{to} of {count}" summary, and
 * the numbered pager. The numbered part is `Pagination` (pagination.tsx) itself, not a
 * second implementation of page-window math and button semantics — that component
 * already carries the accessibility work (disabled, not vanished, previous/next; the
 * active page marked by more than colour alone; RTL-mirrored chevrons) this footer would
 * otherwise have to redo.
 */

import { useDataGrid } from "./data-grid";
import { Pagination } from "./pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export interface DataGridPaginationProps {
  /** Rows-per-page options. Omit the whole control by passing an empty array. */
  sizes?: number[];
}

const DEFAULT_SIZES = [10, 25, 50, 100];

export function DataGridPagination({ sizes = DEFAULT_SIZES }: DataGridPaginationProps) {
  const { table, recordCount, labels } = useDataGrid();
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();

  const from = recordCount === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, recordCount);

  return (
    // `w-full`: `CardFooter` is itself a flex row with no `justify-between` of its own,
    // so without this a flex item sizes to its own content (shrink-to-fit) rather than
    // the footer's real width — this div's own `justify-between` below then only spreads
    // its two groups across that shrunk width, not the actual footer, which is exactly
    // the "everything bunched on the left" bug this fixes.
    <div className="flex w-full flex-wrap items-center justify-between gap-3 border-t border-border p-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {sizes.length > 0 && (
          <label className="flex items-center gap-2">
            <span>{labels.rowsPerPage}</span>
            <Select
              value={`${pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value));
              }}
            >
              <SelectTrigger size="sm" className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((size) => (
                  <SelectItem key={size} value={`${size}`}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        {recordCount > 0 && (
          <span>{labels.pageRangeSummary({ from, to, count: recordCount })}</span>
        )}
      </div>

      <Pagination
        page={pageIndex + 1}
        totalPages={pageCount}
        onPageChange={(page) => {
          table.setPageIndex(page - 1);
        }}
        label={labels.paginationNav}
        previousLabel={labels.previousPage}
        nextLabel={labels.nextPage}
        goToPageLabel={labels.goToPage}
        morePagesLabel={labels.morePages}
      />
    </div>
  );
}
