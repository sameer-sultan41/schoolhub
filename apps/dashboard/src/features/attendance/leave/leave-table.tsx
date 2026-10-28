"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { CalendarOff } from "lucide-react";

import { CursorDataGridCard } from "@/features/attendance/cursor-data-grid-card";
import { LeaveDecisionDialog } from "@/features/attendance/leave/leave-decision-dialog";
import { LeaveDetailSheet } from "@/features/attendance/leave/leave-detail-sheet";
import { useLeaveColumns } from "@/features/attendance/leave/leave-columns";
import { LeaveFilters } from "@/features/attendance/leave/leave-filters";
import { useCursorList } from "@/features/attendance/use-cursor-list";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type LeaveAction, type LeaveRequestRecord } from "@/services";
import {
  LEAVE_APPROVE_PERMISSION,
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
  const { data: currentUser } = useCurrentUser();
  const canApprove = hasPermission(currentUser, LEAVE_APPROVE_PERMISSION);

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

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter change starts over.
    resetKey: [filters.status, filters.type, filters.from, filters.to].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(LEAVE_QUERY_MODULE, LEAVE_LIST_RESOURCE, {
        cursor,
        pageSize: LEAVE_PAGE_SIZE,
        status: filters.status,
        type: filters.type,
        from: filters.from,
        to: filters.to,
      }),
    queryFn: (cursor) =>
      Services.leaveRequests.fetchLeavePage({
        cursor,
        pageSize: LEAVE_PAGE_SIZE,
        ordering: LEAVE_ORDERING,
        status: statusFilterToStatus(filters.status),
        leaveTypeId: filters.type || undefined,
        dateFrom: filters.from || undefined,
        dateTo: filters.to || undefined,
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility },
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (request) => request.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("leave.caption")}
        paginationLabel={t("leave.pagination")}
        loadErrorMessage={t("leave.loadError")}
        filters={<LeaveFilters values={filters} onChange={setFilters} />}
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
      />
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
