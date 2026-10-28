"use client";

import type { ReactElement, ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Table } from "@tanstack/react-table";
import {
  Card,
  CardFooter,
  CardHeader,
  CardHeading,
  CardTable,
  CardToolbar,
  cn,
  CursorPagination,
  DATA_GRID_CARD_CLASSNAME,
  DataGrid,
  DataGridColumnVisibility,
  DataGridTable,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import type { CursorList } from "@/features/attendance/use-cursor-list";
import { resolveErrorMessage } from "@/lib/error-message";

export interface CursorDataGridCardProps<TItem extends object> {
  /** The list read, from `useCursorList`. */
  list: CursorList<TItem>;
  /** The screen's own table: its columns, sort and column visibility over `list.rows`. */
  table: Table<TItem>;
  /** The grid's screen-reader caption, naming what it lists. */
  caption: string;
  /** The pager's accessible name. */
  paginationLabel: string;
  /** Shown when the read fails and the error names nothing more specific. */
  loadErrorMessage: string;
  /** The screen's filter controls: kept on a failure, so a filter that caused it can change. */
  filters: ReactNode;
  emptyState: ReactElement;
  onRowClick?: (row: TItem) => void;
}

/**
 * A cursor-paginated list's card: the filters above the grid, the grid itself, and Previous /
 * Next below it, or the filters and a load-failure card with Try again. While a new page loads
 * the rows shown are the old page's, faded, and both arrows are held.
 */
export function CursorDataGridCard<TItem extends object>({
  list,
  table,
  caption,
  paginationLabel,
  loadErrorMessage,
  filters,
  emptyState,
  onRowClick,
}: CursorDataGridCardProps<TItem>) {
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { query, rows, stack, nextCursor } = list;

  if (query.isError) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2.5 pb-4">{filters}</div>
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, loadErrorMessage)}
          onRetry={list.retry}
        />
      </>
    );
  }

  return (
    <DataGrid
      table={table}
      recordCount={rows.length}
      isLoading={query.isPending}
      caption={caption}
      tableLayout={{ cellBorder: true, columnsVisibility: true }}
      labels={DASHBOARD_DATA_GRID_LABELS}
      onRowClick={onRowClick}
      emptyState={emptyState}
    >
      <Card className={DATA_GRID_CARD_CLASSNAME}>
        <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
          <CardHeading>
            <div className="flex flex-wrap items-center gap-2.5">{filters}</div>
          </CardHeading>
          <CardToolbar>
            <DataGridColumnVisibility />
          </CardToolbar>
        </CardHeader>
        <div className={cn("min-w-0 transition-opacity", query.isFetching && "opacity-50")}>
          <ScrollArea>
            <CardTable>
              <DataGridTable />
            </CardTable>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
        <CardFooter className="justify-end gap-2 border-t-0">
          <CursorPagination
            label={paginationLabel}
            previousLabel={tCommon("previous")}
            nextLabel={tCommon("next")}
            hasPrevious={stack.hasPrevious && !query.isPlaceholderData}
            hasNext={nextCursor !== null && !query.isPlaceholderData}
            onPrevious={stack.goPrevious}
            onNext={() => {
              if (nextCursor !== null) stack.goNext(nextCursor);
            }}
          />
        </CardFooter>
      </Card>
    </DataGrid>
  );
}
