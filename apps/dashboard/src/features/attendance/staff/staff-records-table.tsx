"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { ClipboardList } from "lucide-react";

import { CursorDataGridCard } from "@/features/attendance/cursor-data-grid-card";
import { RequestCorrectionDialog } from "@/features/attendance/request-correction-dialog";
import { useCursorList } from "@/features/attendance/use-cursor-list";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering, todayIsoDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type StaffAttendanceRecord } from "@/services";
import {
  STAFF_ATTENDANCE_LIST_RESOURCE,
  STAFF_ATTENDANCE_QUERY_MODULE,
  STAFF_HISTORY_DEFAULT_SORTING,
  STAFF_HISTORY_PAGE_SIZE,
  STAFF_HISTORY_SORT_FIELD,
  STAFF_HISTORY_SORTABLE_IDS,
  STAFF_HISTORY_URL_FILTERS,
} from "@/services/modules/staff-attendance/staff-attendance-constant";
import {
  defaultStaffHistoryRange,
  staffStatusFilterToStatus,
} from "@/services/modules/staff-attendance/staff-attendance-helper";
import { useStaffRecordColumns } from "./staff-record-columns";
import { StaffRecordsFilters } from "./staff-records-filters";

/**
 * The staff attendance history: every record the viewer may read (their own, for a staff member
 * whose role is own-scoped; the API decides), newest day first, over a date range (the last 30
 * days unless the URL says otherwise). Filters and sort live in the URL; the list is cursor
 * paginated, so there is Previous and Next and no page numbers. A locked row offers Request
 * correction to a holder of `attendance.correction.create`.
 */
export function StaffRecordsTable() {
  const t = useTranslations("attendance");
  const { data: currentUser } = useCurrentUser();
  const canCorrect = hasPermission(currentUser, "attendance.correction.create");

  const [correcting, setCorrecting] = useState<StaffAttendanceRecord | null>(null);
  const handleRequestCorrection = useCallback((record: StaffAttendanceRecord) => {
    setCorrecting(record);
  }, []);

  const columns = useStaffRecordColumns(canCorrect, handleRequestCorrection);
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const {
    filters,
    setFilters,
    sorting,
    onSortingChange,
    columnVisibility,
    onColumnVisibilityChange,
  } = useDataGridUrlState({
    filters: STAFF_HISTORY_URL_FILTERS,
    sortableIds: STAFF_HISTORY_SORTABLE_IDS,
    defaultSorting: STAFF_HISTORY_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  const defaultRange = defaultStaffHistoryRange(todayIsoDate());
  const from = filters.from || defaultRange.from;
  const to = filters.to || defaultRange.to;
  const hasActiveFilter = filters.status !== FILTER_ALL || filters.from !== "" || filters.to !== "";
  const ordering = toOrdering(sorting, STAFF_HISTORY_SORT_FIELD);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [from, to, filters.status, ordering].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(STAFF_ATTENDANCE_QUERY_MODULE, STAFF_ATTENDANCE_LIST_RESOURCE, {
        cursor,
        pageSize: STAFF_HISTORY_PAGE_SIZE,
        ordering,
        from,
        to,
        status: filters.status,
      }),
    queryFn: (cursor) =>
      Services.staffAttendance.fetchStaffAttendancePage({
        cursor,
        pageSize: STAFF_HISTORY_PAGE_SIZE,
        ordering,
        dateFrom: from,
        dateTo: to,
        status: staffStatusFilterToStatus(filters.status),
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange,
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("staff.history.caption")}
        paginationLabel={t("staff.history.pagination")}
        loadErrorMessage={t("staff.history.loadError")}
        filters={
          <StaffRecordsFilters
            values={{ from, to, status: filters.status }}
            onChange={setFilters}
          />
        }
        emptyState={
          <EmptyState
            icon={ClipboardList}
            title={t(hasActiveFilter ? "records.noMatches" : "records.emptyTitle")}
            description={t(
              hasActiveFilter ? "records.noMatchesDescription" : "records.emptyDescription",
            )}
          />
        }
      />
      {correcting && (
        <RequestCorrectionDialog
          open
          onOpenChange={(open) => {
            if (!open) setCorrecting(null);
          }}
          target={{ kind: "staff", record: correcting }}
        />
      )}
    </>
  );
}
