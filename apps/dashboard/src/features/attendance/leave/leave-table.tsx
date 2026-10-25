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
import { CalendarOff } from "lucide-react";
import { isCursorPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { LeaveDecisionDialog } from "@/features/attendance/leave/leave-decision-dialog";
import { LeaveDetailSheet } from "@/features/attendance/leave/leave-detail-sheet";
import { useLeaveColumns } from "@/features/attendance/leave/leave-columns";
import { LeaveFilters } from "@/features/attendance/leave/leave-filters";
import { useCursorStack } from "@/features/attendance/use-cursor-stack";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type LeaveAction, type LeaveRequestRecord } from "@/services";
import {
  LEAVE_DEFAULT_SORTING,
  LEAVE_LIST_RESOURCE,
  LEAVE_ORDERING,
  LEAVE_PAGE_SIZE,
  LEAVE_QUERY_MODULE,
  LEAVE_SORTABLE_IDS,
  LEAVE_STATUS_PENDING,
  LEAVE_URL_FILTERS,
} from "@/services/modules/leave-requests/leave-requests-constant";
import { statusFilterToStatus } from "@/services/modules/leave-requests/leave-requests-helper";

/**
 * `/attendance/leave`: the student leave requests the viewer may read, newest first, pending by
 * default. A row opens its detail (the reason, the approval chain and the attachment). A holder
 * of `attendance.leave-request.approve` approves or rejects a pending request that is not their
 * own and that they decided no level of, each behind a dialog mounted only while open. Status,
 * leave type and the date range live in the URL; the list is cursor paginated, so there is
 * Previous and Next, and no page numbers.
 */
export function LeaveTable() {
  const t = useTranslations("attendance");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const { data: currentUser } = useCurrentUser();
  const canApprove = hasPermission(currentUser, "attendance.leave-request.approve");

  const [viewing, setViewing] = useState<LeaveRequestRecord | null>(null);
  const [deciding, setDeciding] = useState<{
    request: LeaveRequestRecord;
    action: LeaveAction;
  } | null>(null);
  const handleDecide = useCallback((request: LeaveRequestRecord, action: LeaveAction) => {
    setDeciding({ request, action });
  }, []);

  const columns = useLeaveColumns(currentUser, canApprove, handleDecide);
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const { filters, setFilters, sorting, columnVisibility, onColumnVisibilityChange } =
    useDataGridUrlState({
      filters: LEAVE_URL_FILTERS,
      sortableIds: LEAVE_SORTABLE_IDS,
      defaultSorting: LEAVE_DEFAULT_SORTING,
      hideableIds,
      trimSearch: true,
    });

  // Pending is the queue itself, not a narrowing of it; "all" is no filter either.
  const hasActiveFilter =
    filters.type !== "" ||
    filters.from !== "" ||
    filters.to !== "" ||
    (filters.status !== LEAVE_STATUS_PENDING && filters.status !== FILTER_ALL);

  // A cursor is good only for the query that issued it: any filter change starts over.
  const stack = useCursorStack([filters.status, filters.type, filters.from, filters.to].join("|"));
  const { cursor } = stack;

  const query = useQuery({
    queryKey: queryKeys.list(LEAVE_QUERY_MODULE, LEAVE_LIST_RESOURCE, {
      cursor,
      pageSize: LEAVE_PAGE_SIZE,
      status: filters.status,
      type: filters.type,
      from: filters.from,
      to: filters.to,
    }),
    queryFn: () =>
      Services.leaveRequests.fetchLeavePage({
        cursor,
        pageSize: LEAVE_PAGE_SIZE,
        ordering: LEAVE_ORDERING,
        status: statusFilterToStatus(filters.status),
        leaveTypeId: filters.type || undefined,
        dateFrom: filters.from || undefined,
        dateTo: filters.to || undefined,
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
    getRowId: (request) => request.id,
    getCoreRowModel: getCoreRowModel(),
  });

  const filterControls = <LeaveFilters values={filters} onChange={setFilters} />;

  if (query.isError) {
    // The filters stay, so a filter that caused the failure can be changed or cleared.
    return (
      <>
        <div className="flex flex-wrap items-center gap-2.5 pb-4">{filterControls}</div>
        <LoadErrorCard
          message={resolveErrorMessage(query.error, tErrors, t("leave.loadError"))}
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
        caption={t("leave.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        onRowClick={setViewing}
        emptyState={
          <EmptyState
            icon={CalendarOff}
            title={t(hasActiveFilter ? "leave.noMatches" : "leave.emptyTitle")}
            description={t(
              hasActiveFilter ? "leave.noMatchesDescription" : "leave.emptyDescription",
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
              label={t("leave.pagination")}
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
      <LeaveDetailSheet
        request={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null);
        }}
      />
      {deciding && (
        <LeaveDecisionDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeciding(null);
          }}
          request={deciding.request}
          action={deciding.action}
        />
      )}
    </>
  );
}
