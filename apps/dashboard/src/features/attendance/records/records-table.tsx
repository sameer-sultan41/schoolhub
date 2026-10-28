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
import { useSections } from "@/hooks/use-reference-data";
import { FILTER_ALL } from "@/lib/constants";
import { toOrdering, todayIsoDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type StudentAttendanceRecord } from "@/services";
import {
  ATTENDANCE_LIST_RESOURCE,
  RECORDS_DEFAULT_SORTING,
  RECORDS_PAGE_SIZE,
  RECORDS_SORT_FIELD,
  RECORDS_SORTABLE_IDS,
  RECORDS_URL_FILTERS,
  STUDENT_ATTENDANCE_QUERY_MODULE,
} from "@/services/modules/student-attendance/student-attendance-constant";
import {
  defaultRecordsRange,
  lockFilterToIsLocked,
  statusFilterToStatus,
} from "@/services/modules/student-attendance/student-attendance-helper";
import { useRecordColumns } from "./record-columns";
import { RecordsFilters } from "./records-filters";

/**
 * `/attendance/records`: every attendance record the viewer may read, newest day first, over a
 * date range (the last 7 days unless the URL says otherwise). Filters and sort live in the URL;
 * the list is cursor paginated, so there is Previous and Next, and no page numbers or total. A
 * locked row offers Request correction to a holder of `attendance.correction.create`.
 */
export function RecordsTable() {
  const t = useTranslations("attendance");
  const { data: currentUser } = useCurrentUser();
  const canCorrect = hasPermission(currentUser, "attendance.correction.create");

  const [correcting, setCorrecting] = useState<StudentAttendanceRecord | null>(null);
  const handleRequestCorrection = useCallback((record: StudentAttendanceRecord) => {
    setCorrecting(record);
  }, []);

  const columns = useRecordColumns(canCorrect, handleRequestCorrection);
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  const {
    filters,
    setFilters,
    sorting,
    onSortingChange,
    columnVisibility,
    onColumnVisibilityChange,
  } = useDataGridUrlState({
    filters: RECORDS_URL_FILTERS,
    sortableIds: RECORDS_SORTABLE_IDS,
    defaultSorting: RECORDS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  const defaultRange = defaultRecordsRange(todayIsoDate());
  const from = filters.from || defaultRange.from;
  const to = filters.to || defaultRange.to;
  // The Section picker lists one class's sections, so a section applies only with its class: an
  // orphan `section` in the URL (no class, or another class's) is dropped, never filtered by
  // invisibly. Until the class's sections load it is trusted.
  const sectionsQuery = useSections(filters.class);
  const sectionListed =
    sectionsQuery.data === undefined ||
    sectionsQuery.data.some((section) => section.id === filters.section);
  const sectionId = filters.class !== "" && sectionListed ? filters.section : "";
  const hasActiveFilter =
    filters.class !== "" ||
    sectionId !== "" ||
    filters.status !== FILTER_ALL ||
    filters.locked !== FILTER_ALL ||
    filters.from !== "" ||
    filters.to !== "";
  const ordering = toOrdering(sorting, RECORDS_SORT_FIELD);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter or sort change starts over.
    resetKey: [from, to, filters.class, sectionId, filters.status, filters.locked, ordering].join(
      "|",
    ),
    queryKey: (cursor) =>
      queryKeys.list(STUDENT_ATTENDANCE_QUERY_MODULE, ATTENDANCE_LIST_RESOURCE, {
        cursor,
        pageSize: RECORDS_PAGE_SIZE,
        ordering,
        from,
        to,
        class: filters.class,
        section: sectionId,
        status: filters.status,
        locked: filters.locked,
      }),
    queryFn: (cursor) =>
      Services.studentAttendance.fetchAttendancePage({
        cursor,
        pageSize: RECORDS_PAGE_SIZE,
        ordering,
        dateFrom: from,
        dateTo: to,
        classId: filters.class || undefined,
        sectionId: sectionId || undefined,
        status: statusFilterToStatus(filters.status),
        isLocked: lockFilterToIsLocked(filters.locked),
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

  const filterValues = {
    from,
    to,
    class: filters.class,
    section: sectionId,
    status: filters.status,
    locked: filters.locked,
  };

  return (
    <>
      <CursorDataGridCard
        list={list}
        table={table}
        caption={t("records.caption")}
        paginationLabel={t("records.pagination")}
        loadErrorMessage={t("records.loadError")}
        filters={
          <RecordsFilters
            values={filterValues}
            sections={sectionsQuery.data ?? []}
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
          target={{ kind: "student", record: correcting }}
        />
      )}
    </>
  );
}
