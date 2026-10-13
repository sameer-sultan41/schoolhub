"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { m } from "motion/react";
import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardHeading,
  CardTable,
  CardToolbar,
  DATA_GRID_CARD_CLASSNAME,
  DataGrid,
  DataGridColumnVisibility,
  DataGridPagination,
  DataGridTable,
  EmptyState,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";
import { Users } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";

import { ApiError, Services } from "@/services";
import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { resolveErrorMessage } from "@/lib/error-message";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import {
  SORT_FIELD,
  STUDENT_DEFAULT_SORTING,
  STUDENT_FILTER_ALL,
  STUDENT_SORTABLE_IDS,
  STUDENT_URL_FILTERS,
  STUDENT_WITHDRAWABLE_STATUS,
} from "@/services/modules/students/students-constant";
import { toStudentRow } from "@/services/modules/students/students-helper";
import type { StudentRow } from "@/services/modules/students/students-type";
import { StudentCreateStepper, type StepKey } from "./student-create-stepper";
import { StudentDetailSheet } from "./student-detail-sheet";
import { StudentIdCardsButton } from "./student-id-cards-button";
import { WithdrawStudentDialog } from "./withdraw-student-dialog";
import { StudentDirectoryFilters } from "./student-directory-filters";
import { useStudentColumns } from "./student-columns";

/**
 * The `/students` route's directory table — server-paginated/sorted/searched via
 * `Services.students.fetchStudentsPage`, wiring together the edit stepper, the detail
 * sheet and the withdraw dialog.
 *
 * `editTarget`/`withdrawDialog` are conditionally RENDERED (`{editTarget && <... />}`),
 * not kept mounted with `open` merely toggling — deliberately, so each dialog gets a
 * fresh mount per open (`StudentCreateStepper`'s own edit-mode mounting contract). For
 * `WithdrawStudentDialog` this is a hard requirement, not a preference: it has no
 * reset-on-reopen logic at all (see its own mounting-contract comment), so an
 * always-mounted version here would reopen showing a previous withdrawal's stale
 * failures, targets and idempotency keys for a different selection.
 */
export function StudentDirectoryTable() {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");

  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [editTarget, setEditTarget] = useState<{
    studentId: string;
    initialStepKey?: StepKey;
  } | null>(null);
  const [withdrawDialog, setWithdrawDialog] = useState<{ ids: string[]; names: string[] } | null>(
    null,
  );
  const [detailRow, setDetailRow] = useState<StudentRow | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "students.student.update");
  const canWithdraw = hasPermission(currentUser, "students.student.withdraw");
  const canGenerateIdCards = hasPermission(currentUser, "students.id-card.generate");

  // Referentially stable across renders (empty deps) so `useStudentColumns`'s own
  // `useMemo` actually skips recomputation on a parent re-render that doesn't touch
  // these — a search-input keystroke before the debounce fires, for instance. Safe:
  // both bodies only call `useState` setters, which React guarantees are themselves
  // stable, so there is nothing from an outer scope these need to close over freshly.
  const handleEdit = useCallback((id: string) => {
    // The row's own Edit action has no tab context to carry — unlike the detail
    // sheet's Edit button below, it never had a tab open in the first place —
    // so this always lands the stepper on Profile.
    setEditTarget({ studentId: id });
  }, []);
  const handleWithdraw = useCallback((id: string, name: string) => {
    setWithdrawDialog({ ids: [id], names: [name] });
  }, []);

  const columns = useStudentColumns(canUpdate, canWithdraw, handleEdit, handleWithdraw);
  const hideableIds = useMemo(() => hideableColumnIds(columns), [columns]);

  // Search, filters, sort, page, page size and hidden columns live in the URL, so a
  // reload keeps the view and a link shares it. Row selection and dialogs stay local.
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
    filters: STUDENT_URL_FILTERS,
    sortableIds: STUDENT_SORTABLE_IDS,
    defaultSorting: STUDENT_DEFAULT_SORTING,
    hideableIds,
    trimSearch: false,
  });
  const statusFilter = filters.status;
  const campusId = filters.campus;
  const houseId = filters.house;
  const academicSessionId = filters.session;
  const classId = filters.class;
  // A section only exists under its class; one left in the URL without a class isn't sent.
  const sectionId = classId === "" ? "" : filters.section;

  // Default: status filter starts at "active", not "all" — so the defaults themselves
  // never count as "the viewer applied a filter" (see `hasActiveFilter` below).
  const hasActiveFilter =
    search !== "" ||
    statusFilter !== STUDENT_WITHDRAWABLE_STATUS ||
    campusId !== "" ||
    houseId !== "" ||
    academicSessionId !== "" ||
    classId !== "" ||
    sectionId !== "";

  const ordering = sorting[0]
    ? `${sorting[0].desc ? "-" : ""}${SORT_FIELD[sorting[0].id] ?? sorting[0].id}`
    : undefined;
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;

  const query = useQuery({
    queryKey: queryKeys.list("students", "students", {
      page,
      pageSize,
      search,
      ordering,
      statusFilter,
      campusId,
      houseId,
      academicSessionId,
      classId,
      sectionId,
    }),
    queryFn: () =>
      Services.students.fetchStudentsPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        status: statusFilter === STUDENT_FILTER_ALL ? undefined : statusFilter,
        campusId: campusId || undefined,
        houseId: houseId || undefined,
        academicSessionId: academicSessionId || undefined,
        classId: classId || undefined,
        sectionId: sectionId || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  // `Page<T>.pagination` is itself optional, and `total_count` is required only on the
  // `OffsetPagination` arm of the `Pagination` union — guard both before reading it,
  // never a single `?.` straight through to `total_count`.
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

  const rows = useMemo(() => (query.data?.items ?? []).map(toStudentRow), [query.data]);

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting, rowSelection, columnVisibility },
    onPaginationChange,
    onSortingChange,
    onColumnVisibilityChange,
    onRowSelectionChange: setRowSelection,
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: true,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
  });

  // Stable, so the filters' stale-section effect re-runs only when its inputs change.
  const setSection = useCallback(
    (section: string) => {
      setFilters({ section });
    },
    [setFilters],
  );

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  // Bulk withdraw only ever offers/acts on the ACTIVE subset of what's selected,
  // regardless of `canWithdraw` — a non-active row has nothing to withdraw from.
  const selectedWithdrawable = selected.filter((s) => s.status === STUDENT_WITHDRAWABLE_STATUS);

  useEffect(() => {
    if (withdrawDialog === null) setRowSelection({});
  }, [withdrawDialog]);

  if (query.isError && !isStalePage) {
    const isPermissionDenied = query.error instanceof ApiError && query.error.isPermissionDenied;
    // A non-ApiError (network failure, etc.) must not read as "forbidden" — that's a
    // distinct failure with no permission implication, so it gets its own fallback
    // rather than reusing `list.forbidden` as a catch-all.
    return (
      <Card>
        <p className="p-6 text-sm text-muted-foreground">
          {isPermissionDenied
            ? t("list.forbidden")
            : resolveErrorMessage(query.error, tErrors, t("list.loadError"))}
        </p>
      </Card>
    );
  }

  return (
    <>
      <DataGrid
        table={table}
        recordCount={totalCount}
        isLoading={query.isPending || isStalePage}
        onRowClick={setDetailRow}
        caption={t("list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={Users}
            title={t(hasActiveFilter ? "list.noMatches" : "list.emptyTitle")}
            description={t("list.emptyDescription")}
          />
        }
      >
        {/* No `key`, so a filter/sort/page change doesn't replay this — it fires once,
            on the table's first appearance, matching `/staff`'s own directory card. */}
        <m.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <Card className={DATA_GRID_CARD_CLASSNAME}>
            <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
              <CardHeading>
                {/* `CardHeading` itself only applies vertical spacing (`space-y-1`) for a
                    stacked title+subtitle; the filter row needs its own horizontal flex,
                    matching staff's identical inner wrapper. */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <StudentDirectoryFilters
                    searchInput={searchInput}
                    onSearchInputChange={setSearchInput}
                    statusFilter={statusFilter}
                    onStatusFilterChange={(status) => {
                      setFilters({ status });
                    }}
                    campusId={campusId}
                    onCampusIdChange={(campus) => {
                      setFilters({ campus });
                    }}
                    houseId={houseId}
                    onHouseIdChange={(house) => {
                      setFilters({ house });
                    }}
                    academicSessionId={academicSessionId}
                    onAcademicSessionIdChange={(session) => {
                      setFilters({ session });
                    }}
                    classId={classId}
                    // A class change clears the section in the same write.
                    onClassIdChange={(schoolClass) => {
                      setFilters({ class: schoolClass, section: "" });
                    }}
                    sectionId={sectionId}
                    onSectionIdChange={setSection}
                  />
                </div>
              </CardHeading>
              <CardToolbar>
                {/* Every selected row, unlike withdraw's active-only subset: the backend
                    renders an ID card for any live student. */}
                {canGenerateIdCards && (
                  <StudentIdCardsButton studentIds={selected.map((s) => s.id)} />
                )}
                {selectedWithdrawable.length > 0 && canWithdraw && (
                  <m.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setWithdrawDialog({
                          ids: selectedWithdrawable.map((s) => s.id),
                          names: selectedWithdrawable.map((s) => s.name),
                        });
                      }}
                    >
                      {t("withdraw.confirmBulk", { count: selectedWithdrawable.length })}
                    </Button>
                  </m.div>
                )}
                <DataGridColumnVisibility />
              </CardToolbar>
            </CardHeader>
            <m.div
              className="min-w-0"
              animate={{ opacity: query.isFetching ? 0.5 : 1 }}
              transition={{ duration: 0.15 }}
            >
              <ScrollArea>
                <CardTable>
                  <DataGridTable />
                </CardTable>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </m.div>
            <CardFooter className="border-t-0">
              <DataGridPagination />
            </CardFooter>
          </Card>
        </m.div>
      </DataGrid>
      {editTarget && (
        <StudentCreateStepper
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          mode="edit"
          studentId={editTarget.studentId}
          initialStepKey={editTarget.initialStepKey}
        />
      )}
      {withdrawDialog && (
        <WithdrawStudentDialog
          open
          onOpenChange={(open) => {
            if (!open) setWithdrawDialog(null);
          }}
          studentIds={withdrawDialog.ids}
          studentNames={withdrawDialog.names}
        />
      )}
      <StudentDetailSheet
        row={detailRow}
        canUpdate={canUpdate}
        canWithdraw={canWithdraw}
        onOpenChange={(open) => {
          if (!open) setDetailRow(null);
        }}
        onEdit={(id, initialStepKey) => {
          setDetailRow(null);
          setEditTarget({ studentId: id, initialStepKey });
        }}
        onWithdraw={(id, name) => {
          setDetailRow(null);
          setWithdrawDialog({ ids: [id], names: [name] });
        }}
      />
    </>
  );
}
