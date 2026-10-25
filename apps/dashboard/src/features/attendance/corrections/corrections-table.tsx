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
  CursorPagination,
  DATA_GRID_CARD_CLASSNAME,
  DataGrid,
  DataGridColumnVisibility,
  DataGridTable,
  EmptyState,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";
import { FilePenLine } from "lucide-react";
import { isCursorPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { CorrectionDecisionDialog } from "@/features/attendance/corrections/correction-decision-dialog";
import { useCorrectionColumns } from "@/features/attendance/corrections/correction-columns";
import { CorrectionsFilters } from "@/features/attendance/corrections/corrections-filters";
import { useCursorStack } from "@/features/attendance/use-cursor-stack";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type AttendanceCorrectionRecord, type CorrectionAction } from "@/services";
import {
  CORRECTION_STATUS_PENDING,
  CORRECTIONS_DEFAULT_SORTING,
  CORRECTIONS_LIST_RESOURCE,
  CORRECTIONS_ORDERING,
  CORRECTIONS_PAGE_SIZE,
  CORRECTIONS_QUERY_MODULE,
  CORRECTIONS_SORTABLE_IDS,
  CORRECTIONS_URL_FILTERS,
} from "@/services/modules/attendance-corrections/attendance-corrections-constant";
import {
  mineFilterToMine,
  statusFilterToStatus,
} from "@/services/modules/attendance-corrections/attendance-corrections-helper";

/**
 * `/attendance/corrections`: the correction requests the viewer may read, newest first, pending
 * by default. A holder of `attendance.correction.approve` approves or rejects a pending request
 * from someone else, each behind a dialog mounted only while open. Status and Mine live in the
 * URL; the list is cursor paginated, so there is Previous and Next, and no page numbers.
 */
export function CorrectionsTable() {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: currentUser } = useCurrentUser();
  const canApprove = hasPermission(currentUser, "attendance.correction.approve");

  const [deciding, setDeciding] = useState<{
    record: AttendanceCorrectionRecord;
    action: CorrectionAction;
  } | null>(null);
  const handleDecide = useCallback(
    (record: AttendanceCorrectionRecord, action: CorrectionAction) => {
      setDeciding({ record, action });
    },
    [],
  );

  const columns = useCorrectionColumns(currentUser, canApprove, handleDecide);
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const { filters, setFilters, sorting, columnVisibility, onColumnVisibilityChange } =
    useDataGridUrlState({
      filters: CORRECTIONS_URL_FILTERS,
      sortableIds: CORRECTIONS_SORTABLE_IDS,
      defaultSorting: CORRECTIONS_DEFAULT_SORTING,
      hideableIds,
      trimSearch: true,
    });

  // Pending is the queue itself, not a narrowing of it; "all" is no filter either.
  const hasActiveFilter =
    filters.mine !== "" ||
    (filters.status !== CORRECTION_STATUS_PENDING && filters.status !== FILTER_ALL);

  // A cursor is good only for the query that issued it: any filter change starts over.
  const stack = useCursorStack([filters.status, filters.mine].join("|"));
  const { cursor } = stack;

  const query = useQuery({
    queryKey: queryKeys.list(CORRECTIONS_QUERY_MODULE, CORRECTIONS_LIST_RESOURCE, {
      cursor,
      pageSize: CORRECTIONS_PAGE_SIZE,
      status: filters.status,
      mine: filters.mine,
    }),
    queryFn: () =>
      Services.attendanceCorrections.fetchCorrectionPage({
        cursor,
        pageSize: CORRECTIONS_PAGE_SIZE,
        ordering: CORRECTIONS_ORDERING,
        status: statusFilterToStatus(filters.status),
        mine: mineFilterToMine(filters.mine),
      }),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);
  const pageMeta = query.data?.pagination;
  const nextCursor = pageMeta && isCursorPagination(pageMeta) ? pageMeta.next_cursor : null;

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility },
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  const filterControls = <CorrectionsFilters values={filters} onChange={setFilters} />;

  if (query.isError) {
    // The filters stay, so a filter that caused the failure can be changed or cleared.
    return (
      <>
        <div className="flex flex-wrap items-center gap-2.5 pb-4">{filterControls}</div>
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("corrections.loadError"))}
          onRetry={() => {
            // A cursor the server no longer accepts would fail again: start over from page one.
            if (stack.hasPrevious) stack.reset();
            else void query.refetch();
          }}
        />
      </>
    );
  }

  return (
    <>
      <DataGrid
        table={table}
        recordCount={rows.length}
        isLoading={query.isPending}
        caption={t("corrections.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={FilePenLine}
            title={t(hasActiveFilter ? "corrections.noMatches" : "corrections.emptyTitle")}
            description={t(
              hasActiveFilter ? "corrections.noMatchesDescription" : "corrections.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">{filterControls}</div>
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
            {/* While a new page loads, the shown rows are the old page's: hold both arrows. */}
            <CursorPagination
              label={t("corrections.pagination")}
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
      {deciding && (
        <CorrectionDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          record={deciding.record}
          action={deciding.action}
        />
      )}
    </>
  );
}
