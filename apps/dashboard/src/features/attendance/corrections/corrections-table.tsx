"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { EmptyState } from "@schoolhub/ui";
import { FilePenLine } from "lucide-react";

import { CorrectionDecisionDialog } from "@/features/attendance/corrections/correction-decision-dialog";
import { useCorrectionColumns } from "@/features/attendance/corrections/correction-columns";
import { CorrectionsFilters } from "@/features/attendance/corrections/corrections-filters";
import { CursorDataGridCard } from "@/features/attendance/cursor-data-grid-card";
import { useCursorList } from "@/features/attendance/use-cursor-list";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { FILTER_ALL } from "@/lib/constants";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type AttendanceCorrectionRecord, type CorrectionAction } from "@/services";
import {
  CORRECTION_STATUS_PENDING,
  CORRECTION_SUBJECT_TYPES,
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
 * from someone else, each behind a dialog mounted only while open. Status, whose rows (a
 * student's or staff's) and Mine live in the URL; the list is cursor paginated, so there is
 * Previous and Next, and no page numbers.
 */
export function CorrectionsTable() {
  const t = useTranslations("attendance");
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
    filters.subject !== "" ||
    (filters.status !== CORRECTION_STATUS_PENDING && filters.status !== FILTER_ALL);
  // A blank (or unknown) subject is both kinds of row.
  const subjectType = CORRECTION_SUBJECT_TYPES.find((subject) => subject === filters.subject);

  const list = useCursorList({
    // A cursor is good only for the query that issued it: any filter change starts over.
    resetKey: [filters.status, filters.mine, filters.subject].join("|"),
    queryKey: (cursor) =>
      queryKeys.list(CORRECTIONS_QUERY_MODULE, CORRECTIONS_LIST_RESOURCE, {
        cursor,
        pageSize: CORRECTIONS_PAGE_SIZE,
        status: filters.status,
        mine: filters.mine,
        subject: filters.subject,
      }),
    queryFn: (cursor) =>
      Services.attendanceCorrections.fetchCorrectionPage({
        cursor,
        pageSize: CORRECTIONS_PAGE_SIZE,
        ordering: CORRECTIONS_ORDERING,
        status: statusFilterToStatus(filters.status),
        mine: mineFilterToMine(filters.mine),
        subjectType,
      }),
  });

  const table = useReactTable({
    data: list.rows,
    columns,
    state: { sorting, columnVisibility },
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
        caption={t("corrections.caption")}
        paginationLabel={t("corrections.pagination")}
        loadErrorMessage={t("corrections.loadError")}
        filters={<CorrectionsFilters values={filters} onChange={setFilters} />}
        emptyState={
          <EmptyState
            icon={FilePenLine}
            title={t(hasActiveFilter ? "corrections.noMatches" : "corrections.emptyTitle")}
            description={t(
              hasActiveFilter ? "corrections.noMatchesDescription" : "corrections.emptyDescription",
            )}
          />
        }
      />
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
