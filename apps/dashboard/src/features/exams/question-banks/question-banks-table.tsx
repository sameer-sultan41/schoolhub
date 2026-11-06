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
import { Library } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { FILTER_ALL } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type QuestionBankRecord } from "@/services";
import {
  BANKS_DEFAULT_SORTING,
  BANKS_SORT_FIELD,
  BANKS_SORTABLE_IDS,
  BANKS_URL_FILTERS,
  QUESTION_BANKS_LIST_RESOURCE,
  QUESTION_BANKS_QUERY_MODULE,
} from "@/services/modules/question-banks/question-banks-constant";
import { bankStatusFilter } from "@/services/modules/question-banks/question-banks-helper";
import { DeleteQuestionBankDialog } from "./delete-question-bank-dialog";
import { useQuestionBankColumns } from "./question-bank-columns";
import { QuestionBankFilters } from "./question-bank-filters";
import { QuestionBankFormDialog } from "./question-bank-form-dialog";

/**
 * The `/exams/question-banks` list: the banks the viewer's record scope reaches (an `assigned`
 * teacher sees their subjects' banks, at every level), server paginated and searched through
 * `Services.questionBanks.fetchBanksPage`, with edit and remove dialogs. The view state lives in
 * the URL (`useDataGridUrlState`); each dialog is mounted only while open.
 */
export function QuestionBanksTable() {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");

  const [editTarget, setEditTarget] = useState<QuestionBankRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuestionBankRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "exams.question-bank.update");
  const canDelete = hasPermission(currentUser, "exams.question-bank.delete");

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: QuestionBankRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: QuestionBankRecord) => {
    setDeleteTarget(record);
  }, []);

  const columns = useQuestionBankColumns({
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
    filters: BANKS_URL_FILTERS,
    sortableIds: BANKS_SORTABLE_IDS,
    defaultSorting: BANKS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  const hasActiveFilter = search !== "" || filters.subject !== "" || filters.status !== FILTER_ALL;
  const ordering = toOrdering(sorting, BANKS_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const subjectId = filters.subject || undefined;
  const status = bankStatusFilter(filters.status);

  const query = useQuery({
    queryKey: queryKeys.list(QUESTION_BANKS_QUERY_MODULE, QUESTION_BANKS_LIST_RESOURCE, {
      page,
      pageSize,
      search,
      ordering,
      subjectId,
      status,
    }),
    queryFn: () =>
      Services.questionBanks.fetchBanksPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        subjectId,
        status,
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
        message={resolveErrorMessage(query.error, tErrors, t("questionBanks.list.loadError"))}
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
        caption={t("questionBanks.list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={Library}
            title={t(
              hasActiveFilter ? "questionBanks.list.noMatches" : "questionBanks.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "questionBanks.list.noMatchesDescription"
                : "questionBanks.list.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <QuestionBankFilters
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  values={filters}
                  onChange={setFilters}
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
        <QuestionBankFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          record={editTarget}
        />
      )}
      {deleteTarget && (
        <DeleteQuestionBankDialog
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
