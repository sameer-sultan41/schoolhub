"use client";

import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
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
import { Award } from "lucide-react";
import { isOffsetPagination } from "@schoolhub/types";
import { toast } from "sonner";

import { DASHBOARD_DATA_GRID_LABELS } from "@/app/(app)/shell/data-grid-labels";
import { LoadErrorCard } from "@/components/load-error-card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hideableColumnIds, useDataGridUrlState } from "@/hooks/use-data-grid-url-state";
import { useInvalidateModule } from "@/hooks/use-invalidate-module";
import { usePageClamp } from "@/hooks/use-page-clamp";
import { FILTER_ALL } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { toOrdering } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-client";
import { Services, type GradingScaleRecord } from "@/services";
import {
  GRADING_SCALES_DEFAULT_SORTING,
  GRADING_SCALES_LIST_RESOURCE,
  GRADING_SCALES_QUERY_MODULE,
  GRADING_SCALES_SORT_FIELD,
  GRADING_SCALES_SORTABLE_IDS,
  GRADING_SCALES_URL_FILTERS,
} from "@/services/modules/grading-scales/grading-scales-constant";
import { typeFilterToScaleType } from "@/services/modules/grading-scales/grading-scales-helper";
import { GradeBandsDialog } from "./grade-bands-dialog";
import { DeleteGradingScaleDialog } from "./delete-grading-scale-dialog";
import { GradingScaleFilters } from "./grading-scale-filters";
import { GradingScaleFormDialog } from "./grading-scale-form-dialog";
import { useGradingScaleColumns } from "./grading-scale-columns";

/**
 * The `/exams/grading-scales` list: the tenant's grading scales, server paginated and searched
 * through `Services.gradingScales.fetchScalesPage`, with its band editor, edit and remove
 * dialogs and Make default (`:set-default`). The view state lives in the URL
 * (`useDataGridUrlState`); each dialog is mounted only while open.
 */
export function GradingScalesTable() {
  const t = useTranslations("exams");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");

  const [editTarget, setEditTarget] = useState<GradingScaleRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GradingScaleRecord | null>(null);
  // Held by id, not record: the editor reads its scale's name from the list, which refetches.
  const [bandsTargetId, setBandsTargetId] = useState<string | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "exams.grading-scale.update");

  const invalidateScales = useInvalidateModule(GRADING_SCALES_QUERY_MODULE);
  const makeDefault = useMutation({
    mutationFn: (record: GradingScaleRecord) => Services.gradingScales.setDefault(record.id),
    onSuccess: (_result, record) => {
      invalidateScales();
      toast.success(t("gradingScales.defaultSet", { name: record.name }));
    },
    onError: (error) => {
      toast.error(resolveErrorMessage(error, tErrors, tCommon("submitFailed")));
    },
  });
  const { mutate: runMakeDefault } = makeDefault;

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: GradingScaleRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: GradingScaleRecord) => {
    setDeleteTarget(record);
  }, []);
  const handleBands = useCallback((record: GradingScaleRecord) => {
    setBandsTargetId(record.id);
  }, []);
  const handleMakeDefault = useCallback(
    (record: GradingScaleRecord) => {
      runMakeDefault(record);
    },
    [runMakeDefault],
  );

  const pendingDefaultId = makeDefault.isPending ? makeDefault.variables.id : null;
  const columns = useGradingScaleColumns({
    canUpdate,
    onEdit: handleEdit,
    onRemove: handleRemove,
    onBands: handleBands,
    onMakeDefault: handleMakeDefault,
    pendingDefaultId,
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
    filters: GRADING_SCALES_URL_FILTERS,
    sortableIds: GRADING_SCALES_SORTABLE_IDS,
    defaultSorting: GRADING_SCALES_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  const hasActiveFilter = search !== "" || filters.type !== FILTER_ALL;
  const ordering = toOrdering(sorting, GRADING_SCALES_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const scaleType = typeFilterToScaleType(filters.type);

  const query = useQuery({
    queryKey: queryKeys.list(GRADING_SCALES_QUERY_MODULE, GRADING_SCALES_LIST_RESOURCE, {
      page,
      pageSize,
      search,
      ordering,
      scaleType,
    }),
    queryFn: () =>
      Services.gradingScales.fetchScalesPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        scaleType,
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
  const bandsTarget = rows.find((scale) => scale.id === bandsTargetId) ?? null;

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
        message={resolveErrorMessage(query.error, tErrors, t("gradingScales.list.loadError"))}
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
        caption={t("gradingScales.list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={Award}
            title={t(
              hasActiveFilter ? "gradingScales.list.noMatches" : "gradingScales.list.emptyTitle",
            )}
            description={t(
              hasActiveFilter
                ? "gradingScales.list.noMatchesDescription"
                : "gradingScales.list.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <GradingScaleFilters
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  type={filters.type}
                  onTypeChange={(type) => {
                    setFilters({ type });
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
        <GradingScaleFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          record={editTarget}
        />
      )}
      {deleteTarget && (
        <DeleteGradingScaleDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          record={deleteTarget}
        />
      )}
      {bandsTarget && (
        <GradeBandsDialog
          open
          onOpenChange={(open) => {
            if (!open) setBandsTargetId(null);
          }}
          scale={bandsTarget}
        />
      )}
    </>
  );
}
