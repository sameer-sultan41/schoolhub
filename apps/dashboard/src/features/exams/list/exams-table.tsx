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
  DATA_GRID_CARD_CLASSNAME,
  DataGrid,
  DataGridColumnVisibility,
  DataGridPagination,
  DataGridTable,
  EmptyState,
  ScrollArea,
  ScrollBar,
} from "@schoolhub/ui";
import { ClipboardList } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { useAcademicSession } from "@/components/academic-session/use-academic-session";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { FILTER_ALL } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type ExamRecord, type ExamStatus, type ExamType } from "@/services";
import {
  EXAMS_DEFAULT_SORTING,
  EXAMS_LIST_RESOURCE,
  EXAMS_QUERY_MODULE,
  EXAMS_SORT_FIELD,
  EXAMS_SORTABLE_IDS,
  EXAMS_URL_FILTERS,
} from "@/services/modules/exams/exams-constant";
import { filterToValue } from "@/services/modules/exams/exams-helper";
import { DeleteExamDialog } from "./delete-exam-dialog";
import { useExamColumns } from "./exam-columns";
import { ExamFormDialog } from "./exam-form-dialog";
import { ExamsFilters } from "./exams-filters";

/**
 * The `/exams` list: the tenant's exams, server paginated and searched through
 * `Services.exams.fetchExamsPage`. The view state, filters included, lives in the URL
 * (`useDataGridUrlState`); every filter is unset by default, the current session too, so a teacher
 * whose session list is empty still sees their exams. Each dialog is mounted only while open.
 */
export function ExamsTable() {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");

  const [editTarget, setEditTarget] = useState<ExamRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExamRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "exams.exam.update");
  const canDelete = hasPermission(currentUser, "exams.exam.delete");

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: ExamRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: ExamRecord) => {
    setDeleteTarget(record);
  }, []);

  const columns = useExamColumns({
    canUpdate,
    canDelete,
    onEdit: handleEdit,
    onRemove: handleRemove,
  });
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
    filters: EXAMS_URL_FILTERS,
    sortableIds: EXAMS_SORTABLE_IDS,
    defaultSorting: EXAMS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  // Only a read of the sessions that has failed or come back empty makes the picker absent, and
  // with no picker to clear it a session in the URL would pin the list: it is not applied then.
  const { sessions, isLoading: sessionsLoading } = useAcademicSession("");
  const canPickSession = sessions ? sessions.length > 0 : sessionsLoading;
  const academicSessionId = canPickSession ? filterToValue(filters.session) : undefined;
  const termId = academicSessionId ? filterToValue(filters.term) : undefined;
  const status = filterToValue(filters.status) as ExamStatus | undefined;
  const examType = filterToValue(filters.type) as ExamType | undefined;

  const hasActiveFilter =
    search !== "" ||
    academicSessionId !== undefined ||
    termId !== undefined ||
    status !== undefined ||
    examType !== undefined;
  const ordering = toOrdering(sorting, EXAMS_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;

  const query = useQuery({
    queryKey: queryKeys.list(EXAMS_QUERY_MODULE, EXAMS_LIST_RESOURCE, {
      page,
      pageSize,
      search,
      ordering,
      academicSessionId,
      termId,
      status,
      examType,
    }),
    queryFn: () =>
      Services.exams.fetchExamsPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        academicSessionId,
        termId,
        status,
        examType,
      }),
    placeholderData: keepPreviousData,
  });

  const pageMeta = query.data?.pagination;
  const totalCount = pageMeta && isOffsetPagination(pageMeta) ? pageMeta.total_count : 0;

  const { pageCount, isStalePage } = usePageClamp({
    pageMeta,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    pageIndex: pagination.pageIndex,
    setPageIndex,
  });

  const rows = useMemo(() => query.data?.items ?? [], [query.data]);

  const table = useReactTable({
    data: rows,
    columns,
    pageCount,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange,
    onSortingChange,
    onColumnVisibilityChange,
    manualPagination: true,
    manualSorting: true,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
  });

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("list.loadError"))}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <>
      <DataGrid
        table={table}
        recordCount={totalCount}
        isLoading={query.isPending || isStalePage}
        caption={t("list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={ClipboardList}
            title={t(hasActiveFilter ? "list.noMatches" : "list.emptyTitle")}
            description={t(hasActiveFilter ? "list.noMatchesDescription" : "list.emptyDescription")}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <ExamsFilters
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  values={{ ...filters, session: academicSessionId ?? FILTER_ALL }}
                  onChange={setFilters}
                  sessions={sessions}
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
        <ExamFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          record={editTarget}
        />
      )}
      {deleteTarget && (
        <DeleteExamDialog
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
