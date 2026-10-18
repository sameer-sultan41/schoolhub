"use client";

import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  Alert,
  AlertDescription,
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
import { UserCheck } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { NoSessionCard } from "@/features/academics/no-session-card";
import { useAcademicSession } from "@/features/academics/use-academic-session";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { resolveErrorMessage } from "@/lib/error-message";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type TeacherAllocationRecord } from "@/services";
import {
  ALLOCATION_ACTIONS_COLUMN_ID,
  ALLOCATION_DEFAULT_SORTING,
  ALLOCATION_LIST_RESOURCE,
  ALLOCATION_QUERY_MODULE,
  ALLOCATION_SORT_FIELD,
  ALLOCATION_SORTABLE_IDS,
  ALLOCATION_STATE,
  ALLOCATION_URL_FILTERS,
} from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import { allocationStateToCurrent } from "@/services/modules/teacher-allocations/teacher-allocations-helper";
import type { AllocationRowAction } from "@/services/modules/teacher-allocations/teacher-allocations-type";
import { useAllocationColumns } from "./allocation-columns";
import { AllocationFilters } from "./allocation-filters";
import { AllocationRowDialog, type AllocationRowDialogTarget } from "./allocation-row-dialog";
import { TeacherLoadPanel } from "./teacher-load-panel";

/** One session's teacher allocations (URL list state), under the load panel, with row dialogs. */
export function AllocationTable() {
  const t = useTranslations("academics");
  const tErrors = useTranslations("errors");

  const [rowDialog, setRowDialog] = useState<AllocationRowDialogTarget | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "academics.teacher-allocation.update");
  const canDelete = hasPermission(currentUser, "academics.teacher-allocation.delete");

  // Stable (only state setters inside), so the columns' own `useMemo` skips a rebuild when
  // the table re-renders for a keystroke or a page change.
  const handleAction = useCallback(
    (action: AllocationRowAction, record: TeacherAllocationRecord) => {
      setRowDialog({ action, record });
    },
    [],
  );
  const closeRowDialog = useCallback(() => {
    setRowDialog(null);
  }, []);

  const columns = useAllocationColumns(canUpdate, canDelete, handleAction);
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
    filters: ALLOCATION_URL_FILTERS,
    sortableIds: ALLOCATION_SORTABLE_IDS,
    defaultSorting: ALLOCATION_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });
  const {
    sessions,
    session,
    isLocked,
    isLoading: isSessionLoading,
    isError: isSessionError,
    refetch: refetchSessions,
  } = useAcademicSession(filters.session);

  // Stable, so the filters' stale-section effect re-runs only when its inputs change.
  const setSection = useCallback(
    (section: string) => {
      setFilters({ section });
    },
    [setFilters],
  );

  const classId = filters.class;
  // A section is a valid id here, but means nothing without its class.
  const sectionId = classId === "" ? "" : filters.section;
  const hasActiveFilter =
    search !== "" ||
    classId !== "" ||
    sectionId !== "" ||
    filters.subject !== "" ||
    filters.teacher !== "" ||
    filters.state !== ALLOCATION_STATE.current;

  const ordering = toOrdering(sorting, ALLOCATION_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const current = allocationStateToCurrent(filters.state);
  const academicSessionId = session?.id ?? "";

  const query = useQuery({
    queryKey: queryKeys.list(ALLOCATION_QUERY_MODULE, ALLOCATION_LIST_RESOURCE, {
      page,
      pageSize,
      search,
      ordering,
      academicSessionId,
      classId,
      sectionId,
      subjectId: filters.subject,
      staffId: filters.teacher,
      current,
    }),
    queryFn: () =>
      Services.teacherAllocations.fetchAllocationsPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        academicSessionId,
        classId: classId || undefined,
        sectionId: sectionId || undefined,
        subjectId: filters.subject || undefined,
        staffId: filters.teacher || undefined,
        current,
      }),
    // Until a session resolves there is nothing to ask for.
    enabled: session !== null,
    placeholderData: keepPreviousData,
  });

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

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);

  // A locked session is read-only, and a viewer with neither action has nothing to show.
  const showActions = (canUpdate || canDelete) && !isLocked;
  const visibility = useMemo(
    () => ({ ...columnVisibility, [ALLOCATION_ACTIONS_COLUMN_ID]: showActions }),
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

  // A failed sessions fetch is not "no session": say so, and let the viewer retry.
  if (isSessionError) {
    return (
      <LoadErrorCard
        message={t("allocations.list.loadError")}
        onRetry={() => {
          void refetchSessions();
        }}
      />
    );
  }

  // No current session (and none picked): the viewer can pick one from the sessions there are.
  if (!isSessionLoading && session === null) {
    return (
      <NoSessionCard
        sessions={sessions}
        onPick={(sessionId) => {
          setFilters({ session: sessionId });
        }}
      />
    );
  }

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("allocations.list.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <>
      {isLocked && session && (
        <Alert variant="info" appearance="light" className="mb-5">
          <AlertDescription>{t("common.lockedNotice", { session: session.name })}</AlertDescription>
        </Alert>
      )}
      <TeacherLoadPanel sessionId={academicSessionId} />
      <DataGrid
        table={table}
        recordCount={totalCount}
        isLoading={query.isPending || isStalePage}
        caption={t("allocations.list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={UserCheck}
            title={t(
              hasActiveFilter ? "allocations.list.noMatches" : "allocations.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "allocations.list.noMatchesDescription"
                : "allocations.list.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <AllocationFilters
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  sessions={sessions}
                  sessionId={academicSessionId}
                  onSessionChange={(sessionId) => {
                    setFilters({ session: sessionId });
                  }}
                  classId={classId}
                  // A class change clears the section in the same write.
                  onClassIdChange={(schoolClass) => {
                    setFilters({ class: schoolClass, section: "" });
                  }}
                  sectionId={sectionId}
                  onSectionIdChange={setSection}
                  subjectId={filters.subject}
                  onSubjectIdChange={(subject) => {
                    setFilters({ subject });
                  }}
                  teacherId={filters.teacher}
                  onTeacherIdChange={(teacher) => {
                    setFilters({ teacher });
                  }}
                  state={filters.state}
                  onStateChange={(state) => {
                    setFilters({ state });
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
      {rowDialog && <AllocationRowDialog target={rowDialog} onClose={closeRowDialog} />}
    </>
  );
}
