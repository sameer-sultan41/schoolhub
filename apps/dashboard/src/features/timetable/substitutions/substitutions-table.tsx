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
import { UserRoundCheck } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { FILTER_ALL } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { todayIsoDate, toOrdering } from "@/lib/helpers";
import { queryKeys } from "@/lib/query-client";
import { Services, type SubstitutionAction, type TeacherSubstitutionRecord } from "@/services";
import {
  SUBSTITUTIONS_DEFAULT_SORTING,
  SUBSTITUTIONS_LIST_RESOURCE,
  SUBSTITUTIONS_QUERY_MODULE,
  SUBSTITUTIONS_SORT_FIELD,
  SUBSTITUTIONS_SORTABLE_IDS,
  SUBSTITUTIONS_URL_FILTERS,
} from "@/services/modules/teacher-substitutions/teacher-substitutions-constant";
import { statusFilterToStatus } from "@/services/modules/teacher-substitutions/teacher-substitutions-helper";
import { SubstitutionActionDialog } from "./substitution-action-dialog";
import { useSubstitutionColumns } from "./substitution-columns";
import { SubstitutionFilters } from "./substitution-filters";

/**
 * The `/timetable/substitutions` queue: every cover, newest first, server paginated, sorted
 * and searched, with its status and date range in the URL. Each row offers the decisions the
 * viewer may take on it, each behind a confirm mounted only while open.
 */
export function SubstitutionsTable() {
  const t = useTranslations("timetable");
  const tErrors = useTranslations("errors");
  const { data: currentUser } = useCurrentUser();
  const today = todayIsoDate();

  const [pending, setPending] = useState<{
    record: TeacherSubstitutionRecord;
    action: SubstitutionAction;
  } | null>(null);
  const handleAction = useCallback(
    (record: TeacherSubstitutionRecord, action: SubstitutionAction) => {
      setPending({ record, action });
    },
    [],
  );

  const columns = useSubstitutionColumns(currentUser, today, handleAction);
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
    filters: SUBSTITUTIONS_URL_FILTERS,
    sortableIds: SUBSTITUTIONS_SORTABLE_IDS,
    defaultSorting: SUBSTITUTIONS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  const hasActiveFilter =
    search !== "" || filters.status !== FILTER_ALL || filters.from !== "" || filters.to !== "";
  const ordering = toOrdering(sorting, SUBSTITUTIONS_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const status = statusFilterToStatus(filters.status);

  const query = useQuery({
    queryKey: queryKeys.list(SUBSTITUTIONS_QUERY_MODULE, SUBSTITUTIONS_LIST_RESOURCE, {
      page,
      pageSize,
      search,
      ordering,
      status,
      from: filters.from,
      to: filters.to,
    }),
    queryFn: () =>
      Services.teacherSubstitutions.fetchSubstitutionPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        status,
        dateFrom: filters.from || undefined,
        dateTo: filters.to || undefined,
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
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("substitutions.list.loadError"))}
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
        caption={t("substitutions.list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={UserRoundCheck}
            title={t(
              hasActiveFilter ? "substitutions.list.noMatches" : "substitutions.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "substitutions.list.noMatchesDescription"
                : "substitutions.list.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <SubstitutionFilters
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  status={filters.status}
                  onStatusChange={(value) => {
                    setFilters({ status: value });
                  }}
                  from={filters.from}
                  onFromChange={(value) => {
                    setFilters({ from: value });
                  }}
                  to={filters.to}
                  onToChange={(value) => {
                    setFilters({ to: value });
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
      {pending && (
        <SubstitutionActionDialog
          open
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          record={pending.record}
          action={pending.action}
        />
      )}
    </>
  );
}
