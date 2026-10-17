"use client";

import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  Alert,
  AlertDescription,
  Button,
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
import { BookOpen, CalendarX } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { SessionPicker } from "@/features/academics/session-picker";
import { useAcademicSession } from "@/features/academics/use-academic-session";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { resolveErrorMessage } from "@/lib/error-message";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type CurriculumRecord } from "@/services";
import {
  CURRICULUM_ACTIONS_COLUMN_ID,
  CURRICULUM_DEFAULT_SORTING,
  CURRICULUM_KIND,
  CURRICULUM_SORT_FIELD,
  CURRICULUM_SORTABLE_IDS,
  CURRICULUM_URL_FILTERS,
} from "@/services/modules/curriculum/curriculum-constant";
import { kindToIsElective } from "@/services/modules/curriculum/curriculum-helper";
import { useCurriculumColumns } from "./curriculum-columns";
import { CurriculumFilters } from "./curriculum-filters";
import { CurriculumFormDialog } from "./curriculum-form-dialog";
import { DeleteCurriculumDialog } from "./delete-curriculum-dialog";

function LoadErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const tCommon = useTranslations("common");

  return (
    <Card>
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button variant="outline" onClick={onRetry}>
          {tCommon("retry")}
        </Button>
      </div>
    </Card>
  );
}

/**
 * The `/academics/curriculum` list: one academic session's class-subject mappings, server
 * paginated, sorted and searched through `Services.curriculum.fetchCurriculumPage`, with its
 * edit and remove dialogs. The view state lives in the URL (`useDataGridUrlState`).
 *
 * The session is the URL's `session`, else the current one (`useAcademicSession`); the list
 * is not requested until one resolves. A locked session is read-only: the actions column is
 * hidden. The edit and remove dialogs are rendered only while open, so each open is fresh.
 */
export function CurriculumTable() {
  const t = useTranslations("academics");
  const tErrors = useTranslations("errors");

  const [editTarget, setEditTarget] = useState<CurriculumRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CurriculumRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "academics.curriculum.update");
  const canDelete = hasPermission(currentUser, "academics.curriculum.delete");

  // Stable (only state setters inside), so the columns' own `useMemo` skips a rebuild when
  // the table re-renders for a keystroke or a page change.
  const handleEdit = useCallback((record: CurriculumRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: CurriculumRecord) => {
    setDeleteTarget(record);
  }, []);

  const columns = useCurriculumColumns(canUpdate, canDelete, handleEdit, handleRemove);
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
    filters: CURRICULUM_URL_FILTERS,
    sortableIds: CURRICULUM_SORTABLE_IDS,
    defaultSorting: CURRICULUM_DEFAULT_SORTING,
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

  const hasActiveFilter =
    search !== "" ||
    filters.class !== "" ||
    filters.campus !== "" ||
    filters.kind !== CURRICULUM_KIND.all;

  const ordering = sorting[0]
    ? `${sorting[0].desc ? "-" : ""}${CURRICULUM_SORT_FIELD[sorting[0].id] ?? sorting[0].id}`
    : undefined;
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const isElective = kindToIsElective(filters.kind);
  const academicSessionId = session?.id ?? "";

  const query = useQuery({
    queryKey: queryKeys.list("curriculum", "class-subjects", {
      page,
      pageSize,
      search,
      ordering,
      academicSessionId,
      classId: filters.class,
      campusId: filters.campus,
      isElective,
    }),
    queryFn: () =>
      Services.curriculum.fetchCurriculumPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        academicSessionId,
        classId: filters.class || undefined,
        campusId: filters.campus || undefined,
        isElective,
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
    () => ({ ...columnVisibility, [CURRICULUM_ACTIONS_COLUMN_ID]: showActions }),
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
        message={t("curriculum.list.loadError")}
        onRetry={() => {
          void refetchSessions();
        }}
      />
    );
  }

  // No current session (and none picked): the viewer can pick one from the sessions there are.
  if (!isSessionLoading && session === null) {
    return (
      <Card>
        <div className="flex flex-col gap-4 p-6">
          <SessionPicker
            sessions={sessions}
            value=""
            onChange={(sessionId) => {
              setFilters({ session: sessionId });
            }}
            className="w-full sm:w-60"
          />
          <EmptyState
            icon={CalendarX}
            title={t("common.noSessionTitle")}
            description={t("common.noSessionDescription")}
          />
        </div>
      </Card>
    );
  }

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("curriculum.list.loadError"))}
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
      <DataGrid
        table={table}
        recordCount={totalCount}
        isLoading={query.isPending || isStalePage}
        caption={t("curriculum.list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={BookOpen}
            title={t(hasActiveFilter ? "curriculum.list.noMatches" : "curriculum.list.emptyTitle")}
            description={t(
              hasActiveFilter
                ? "curriculum.list.noMatchesDescription"
                : "curriculum.list.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <CurriculumFilters
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  sessions={sessions}
                  sessionId={academicSessionId}
                  onSessionChange={(sessionId) => {
                    setFilters({ session: sessionId });
                  }}
                  classId={filters.class}
                  onClassIdChange={(classId) => {
                    setFilters({ class: classId });
                  }}
                  campusId={filters.campus}
                  onCampusIdChange={(campusId) => {
                    setFilters({ campus: campusId });
                  }}
                  kind={filters.kind}
                  onKindChange={(kind) => {
                    setFilters({ kind });
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
      {editTarget && (
        <CurriculumFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          record={editTarget}
          sessions={sessions ?? []}
          sessionId={academicSessionId}
        />
      )}
      {deleteTarget && (
        <DeleteCurriculumDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          record={deleteTarget}
        />
      )}
    </>
  );
}
