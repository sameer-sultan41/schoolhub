"use client";

import type { ReactElement, ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Table } from "@tanstack/react-table";
import {
  Card,
  CardFooter,
  CardHeader,
  CardHeading,
  CardTable,
  CardToolbar,
  cn,
  DATA_GRID_CARD_CLASSNAME,
  DataGrid,
  DataGridColumnVisibility,
  DataGridPagination,
  DataGridTable,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { resolveErrorMessage } from "@/lib/error-message";

export interface PagedGridCardProps<TRow extends object> {
  table: Table<TRow>;
  query: Pick<UseQueryResult, "isPending" | "isFetching" | "isError" | "error" | "refetch">;
  totalCount: number;
  /** A page past the end is loading back to page 1, not an error. */
  isStalePage: boolean;
  /** The grid's screen-reader caption, naming what it lists. */
  caption: string;
  /** Shown when the read fails and the error names nothing more specific. */
  loadErrorMessage: string;
  filters: ReactNode;
  emptyState: ReactElement;
}

/** A server-paged list's card (the School structure lists, the platform console's lists): the
 * filters, the grid and its pager, or a load-failure card with Try again. */
export function PagedGridCard<TRow extends object>({
  table,
  query,
  totalCount,
  isStalePage,
  caption,
  loadErrorMessage,
  filters,
  emptyState,
}: PagedGridCardProps<TRow>) {
  const tErrors = useTranslations("errors");

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, loadErrorMessage)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <DataGrid
      table={table}
      recordCount={totalCount}
      isLoading={query.isPending || isStalePage}
      caption={caption}
      tableLayout={{ cellBorder: true, columnsVisibility: true }}
      labels={DASHBOARD_DATA_GRID_LABELS}
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
        <CardFooter className="border-t-0">
          <DataGridPagination />
        </CardFooter>
      </Card>
    </DataGrid>
  );
}
