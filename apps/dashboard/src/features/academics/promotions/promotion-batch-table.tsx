"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
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
  EmptyState,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";
import { Layers } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { promotionBatchPath } from "@/config/paths";
import { useAcademicSession } from "@/features/academics/use-academic-session";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { resolveErrorMessage } from "@/lib/error-message";
import { toOrdering } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import {
  PROMOTION_BATCHES_RESOURCE,
  PROMOTION_DEFAULT_SORTING,
  PROMOTION_QUERY_MODULE,
  PROMOTION_SORT_FIELD,
  PROMOTION_SORTABLE_IDS,
  PROMOTION_URL_FILTERS,
} from "@/services/modules/promotions/promotions-constant";
import { promotionBatchRowId } from "@/services/modules/promotions/promotions-helper";
import { usePromotionBatchColumns } from "./promotion-batch-columns";
import { PromotionBatchFilters } from "./promotion-batch-filters";

/**
 * Every promotion batch, newest first (URL list state). Not scoped to a session: a session
 * filter that is empty means all of them, so there is no "no session" state here. A batch's row
 * opens its review page.
 */
export function PromotionBatchTable() {
  const t = useTranslations("academics");
  const tErrors = useTranslations("errors");
  const router = useRouter();

  const columns = usePromotionBatchColumns();
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const {
    filters,
    setFilters,
    sorting,
    onSortingChange,
    pagination,
    onPaginationChange,
    columnVisibility,
    onColumnVisibilityChange,
    setPageIndex,
  } = useDataGridUrlState({
    filters: PROMOTION_URL_FILTERS,
    sortableIds: PROMOTION_SORTABLE_IDS,
    defaultSorting: PROMOTION_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });
  // Only the session list, for the filter's options: the list never waits on it.
  const { sessions } = useAcademicSession("");

  const hasActiveFilter = filters.status !== "" || filters.session !== "" || filters.class !== "";
  const ordering = toOrdering(sorting, PROMOTION_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;

  const query = useQuery({
    queryKey: queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE, {
      page,
      pageSize,
      ordering,
      status: filters.status,
      fromAcademicSessionId: filters.session,
      fromClassId: filters.class,
    }),
    queryFn: () =>
      Services.promotions.fetchPromotionBatches({
        page,
        pageSize,
        ordering,
        status: filters.status || undefined,
        fromAcademicSessionId: filters.session || undefined,
        fromClassId: filters.class || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const pageMeta = query.data?.pagination;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;

  // Clamps a page past the end back, and a shared link's 404 for one to page 1.
  const { pageCount, isStalePage } = usePageClamp({
    pageMeta,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    pageIndex: pagination.pageIndex,
    setPageIndex,
  });

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange,
    onSortingChange,
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: promotionBatchRowId,
    getCoreRowModel: getCoreRowModel(),
  });

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("promotions.list.loadError"))}
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
      caption={t("promotions.list.caption")}
      tableLayout={{ cellBorder: true, columnsVisibility: true }}
      labels={DASHBOARD_DATA_GRID_LABELS}
      // The From class cell is a real link; this lets a click anywhere else on the row follow it.
      onRowClick={(batch) => {
        router.push(promotionBatchPath(batch.batch_id));
      }}
      emptyState={
        <EmptyState
          icon={Layers}
          title={t(hasActiveFilter ? "promotions.list.noMatches" : "promotions.list.emptyTitle")}
          description={t(
            hasActiveFilter
              ? "promotions.list.noMatchesDescription"
              : "promotions.list.emptyDescription",
          )}
        />
      }
    >
      <Card className={DATA_GRID_CARD_CLASSNAME}>
        <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
          <CardHeading>
            <div className="flex flex-wrap items-center gap-2.5">
              <PromotionBatchFilters
                sessions={sessions}
                sessionId={filters.session}
                onSessionChange={(session) => {
                  setFilters({ session });
                }}
                classId={filters.class}
                onClassIdChange={(schoolClass) => {
                  setFilters({ class: schoolClass });
                }}
                status={filters.status}
                onStatusChange={(status) => {
                  setFilters({ status });
                }}
              />
            </div>
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
