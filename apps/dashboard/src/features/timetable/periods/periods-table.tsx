"use client";

import { useCallback, useMemo, useState } from "react";
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
import { BellRing } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { resolveErrorMessage } from "@/lib/error-message";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type PeriodRecord } from "@/services";
import {
  PERIOD_KIND,
  PERIODS_ACTIONS_COLUMN_ID,
  PERIODS_DEFAULT_SORTING,
  PERIODS_LIST_RESOURCE,
  PERIODS_QUERY_MODULE,
  PERIODS_SORT_FIELD,
  PERIODS_SORTABLE_IDS,
  PERIODS_URL_FILTERS,
} from "@/services/modules/periods/periods-constant";
import { kindToIsBreak } from "@/services/modules/periods/periods-helper";
import { DeletePeriodDialog } from "./delete-period-dialog";
import { PeriodFilters } from "./period-filters";
import { PeriodFormDialog } from "./period-form-dialog";
import { usePeriodColumns } from "./period-columns";

/**
 * The `/timetable/periods` list: the tenant's bell schedule, server paginated, sorted and
 * searched through `Services.periods.fetchPeriodPage`, with its edit and remove dialogs. The
 * view state lives in the URL (`useDataGridUrlState`); each dialog is mounted only while open.
 */
export function PeriodsTable() {
  const t = useTranslations("timetable");
  const tErrors = useTranslations("errors");

  const [editTarget, setEditTarget] = useState<PeriodRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PeriodRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "timetable.period.update");
  const canDelete = hasPermission(currentUser, "timetable.period.delete");

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: PeriodRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: PeriodRecord) => {
    setDeleteTarget(record);
  }, []);

  const columns = usePeriodColumns(canUpdate, canDelete, handleEdit, handleRemove);
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const {
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    search,
    sorting,
    onSortingChange,
    pagination,
    onPaginationChange,
    columnVisibility,
    onColumnVisibilityChange,
    setPageIndex,
  } = useDataGridUrlState({
    filters: PERIODS_URL_FILTERS,
    sortableIds: PERIODS_SORTABLE_IDS,
    defaultSorting: PERIODS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  const hasActiveFilter =
    search !== "" || filters.campus !== "" || filters.kind !== PERIOD_KIND.all;

  const ordering = toOrdering(sorting, PERIODS_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const isBreak = kindToIsBreak(filters.kind);

  const query = useQuery({
    queryKey: queryKeys.list(PERIODS_QUERY_MODULE, PERIODS_LIST_RESOURCE, {
      page,
      pageSize,
      search,
      ordering,
      forCampusId: filters.campus,
      isBreak,
    }),
    queryFn: () =>
      Services.periods.fetchPeriodPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        forCampusId: filters.campus || undefined,
        isBreak,
      }),
    placeholderData: keepPreviousData,
  });

  const pageMeta = query.data?.pagination;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;

  const { pageCount, isStalePage } = usePageClamp({
    pageMeta,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    pageIndex: pagination.pageIndex,
    setPageIndex,
  });

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);

  const showActions = canUpdate || canDelete;
  const visibility = useMemo(
    () => ({ ...columnVisibility, [PERIODS_ACTIONS_COLUMN_ID]: showActions }),
    [columnVisibility, showActions],
  );

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting, columnVisibility: visibility },
    onPaginationChange,
    onSortingChange,
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("periods.list.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <>
      <DataGrid
        table={table}
        recordCount={totalCount}
        isLoading={query.isPending || isStalePage}
        caption={t("periods.list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={BellRing}
            title={t(hasActiveFilter ? "periods.list.noMatches" : "periods.list.emptyTitle")}
            description={t(
              hasActiveFilter
                ? "periods.list.noMatchesDescription"
                : "periods.list.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <PeriodFilters
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  campusId={filters.campus}
                  onCampusIdChange={(campusId) => {
                    setFilters({ campus: campusId });
                  }}
                  kind={filters.kind}
                  onKindChange={(kind) => {
                    setFilters({ kind });
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
      {editTarget && (
        <PeriodFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          record={editTarget}
        />
      )}
      {deleteTarget && (
        <DeletePeriodDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          record={deleteTarget}
        />
      )}
    </>
  );
}
