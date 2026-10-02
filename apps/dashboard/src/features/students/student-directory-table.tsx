"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
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
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { StudentFormDialog } from "./student-form-dialog";
import { StudentDetailSheet } from "./student-detail-sheet";
import { WithdrawStudentDialog } from "./withdraw-student-dialog";
import { StudentDirectoryFilters } from "./student-directory-filters";
import { SORT_FIELD, useStudentColumns } from "./student-columns";
import { toStudentRow, type StudentRow } from "./student-row";

/**
 * The `/students` route's directory table — server-paginated/sorted/searched via
 * `Services.students.fetchStudentsPage`, wiring together the create/edit form dialog
 * (Task 5), the detail sheet (Task 6) and the withdraw dialog (Task 7).
 *
 * `formDialog`/`withdrawDialog` are conditionally RENDERED (`{formDialog && <... />}`),
 * not kept mounted with `open` merely toggling — deliberately, so each dialog gets a
 * fresh mount per open. For `WithdrawStudentDialog` this is a hard requirement, not a
 * preference: it has no reset-on-reopen logic at all (see its own mounting-contract
 * comment), so an always-mounted version here would reopen showing a previous
 * withdrawal's stale failures, targets and idempotency keys for a different selection.
 */
export function StudentDirectoryTable() {
  const t = useTranslations("students");
  const tErrors = useTranslations("errors");

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const [statusFilter, setStatusFilter] = useState("active");
  const [campusId, setCampusId] = useState("");
  const [houseId, setHouseId] = useState("");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [formDialog, setFormDialog] = useState<
    { mode: "create" } | { mode: "edit"; studentId: string } | null
  >(null);
  const [withdrawDialog, setWithdrawDialog] = useState<{ ids: string[]; names: string[] } | null>(
    null,
  );
  const [detailRow, setDetailRow] = useState<StudentRow | null>(null);

  // Default: status filter starts at "active", not "all" — so the defaults themselves
  // never count as "the viewer applied a filter" (see `hasActiveFilter` below).
  const hasActiveFilter =
    search !== "" || statusFilter !== "active" || campusId !== "" || houseId !== "";

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [search, sorting, statusFilter, campusId, houseId]);

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
    }),
    queryFn: () =>
      Services.students.fetchStudentsPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        status: statusFilter === "all" ? undefined : statusFilter,
        campusId: campusId || undefined,
        houseId: houseId || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  // `Page<T>.pagination` is itself optional, and `total_pages` exists only on the
  // `OffsetPagination` arm of the `Pagination` union — both need guarding before
  // either field is read, never a single `?.` through to `total_pages`/`total_count`.
  const pageMeta = query.data?.pagination;
  const pageCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_pages : 1;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;

  useEffect(() => {
    setPagination((p) =>
      p.pageIndex >= pageCount && pageCount > 0 ? { ...p, pageIndex: pageCount - 1 } : p,
    );
  }, [pageCount]);

  const rows = useMemo(() => (query.data?.items ?? []).map(toStudentRow), [query.data]);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "students.student.update");
  const canWithdraw = hasPermission(currentUser, "students.student.withdraw");

  // Referentially stable across renders (empty deps) so `useStudentColumns`'s own
  // `useMemo` actually skips recomputation on a parent re-render that doesn't touch
  // these — a search-input keystroke before the debounce fires, for instance. Safe:
  // both bodies only call `useState` setters, which React guarantees are themselves
  // stable, so there is nothing from an outer scope these need to close over freshly.
  const handleEdit = useCallback((id: string) => {
    setFormDialog({ mode: "edit", studentId: id });
  }, []);
  const handleWithdraw = useCallback((id: string, name: string) => {
    setWithdrawDialog({ ids: [id], names: [name] });
  }, []);

  const columns = useStudentColumns(canUpdate, canWithdraw, handleEdit, handleWithdraw);

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting, rowSelection },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    manualPagination: true,
    manualSorting: true,
    enableRowSelection: true,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  // Bulk withdraw only ever offers/acts on the ACTIVE subset of what's selected,
  // regardless of `canWithdraw` — a non-active row has nothing to withdraw from.
  const selectedWithdrawable = selected.filter((s) => s.status === "active");

  useEffect(() => {
    if (withdrawDialog === null) setRowSelection({});
  }, [withdrawDialog]);

  if (query.isError) {
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
        isLoading={query.isPending}
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
                    onStatusFilterChange={setStatusFilter}
                    campusId={campusId}
                    onCampusIdChange={setCampusId}
                    houseId={houseId}
                    onHouseIdChange={setHouseId}
                  />
                </div>
              </CardHeading>
              <CardToolbar>
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
      {formDialog && (
        <StudentFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setFormDialog(null);
          }}
          mode={formDialog.mode}
          studentId={formDialog.mode === "edit" ? formDialog.studentId : undefined}
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
        onEdit={(id) => {
          setDetailRow(null);
          setFormDialog({ mode: "edit", studentId: id });
        }}
        onWithdraw={(id, name) => {
          setDetailRow(null);
          setWithdrawDialog({ ids: [id], names: [name] });
        }}
      />
    </>
  );
}
