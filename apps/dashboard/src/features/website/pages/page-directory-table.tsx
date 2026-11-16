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
import { FileText } from "lucide-react";
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
import { Services, type WebsitePageRecord } from "@/services";
import {
  PAGES_DEFAULT_SORTING,
  PAGES_SORT_FIELD,
  PAGES_SORTABLE_IDS,
  PAGES_URL_FILTERS,
  WEBSITE_PAGE_TYPES,
  WEBSITE_PAGES_RESOURCE,
} from "@/services/modules/website/website-pages/website-pages-constant";
import { WEBSITE_CONTENT_STATUSES, WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";
import { DeletePageDialog } from "./delete-page-dialog";
import { usePageColumns } from "./page-columns";
import { PageDirectoryFilters } from "./page-directory-filters";

/**
 * The `/website/pages` list: the school's pages, server paginated, searched, filtered by status
 * and type and sorted through `Services.websitePages.fetchWebsitePagePage`, each title linking to
 * its editor. The view state lives in the URL (ADR-0024); the delete dialog is mounted only
 * while open.
 */
export function PageDirectoryTable() {
  const t = useTranslations("website.pages");
  const tErrors = useTranslations("errors");
  const [deleteTarget, setDeleteTarget] = useState<WebsitePageRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canDelete = hasPermission(currentUser, "website.page.delete");

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleDelete = useCallback((page: WebsitePageRecord) => {
    setDeleteTarget(page);
  }, []);
  const columns = usePageColumns({ canDelete, onDelete: handleDelete });
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
    filters: PAGES_URL_FILTERS,
    sortableIds: PAGES_SORTABLE_IDS,
    defaultSorting: PAGES_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  const hasActiveFilter =
    search !== "" || filters.status !== FILTER_ALL || filters.type !== FILTER_ALL;
  const ordering = toOrdering(sorting, PAGES_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  // "all" matches neither list, so it sends no filter.
  const status = WEBSITE_CONTENT_STATUSES.find((value) => value === filters.status);
  const pageType = WEBSITE_PAGE_TYPES.find((value) => value === filters.type);

  const query = useQuery({
    queryKey: queryKeys.list(WEBSITE_QUERY_MODULE, WEBSITE_PAGES_RESOURCE, {
      page,
      pageSize,
      search,
      ordering,
      status,
      pageType,
    }),
    queryFn: () =>
      Services.websitePages.fetchWebsitePagePage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        status,
        pageType,
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
            icon={FileText}
            title={t(hasActiveFilter ? "list.noMatches" : "list.emptyTitle")}
            description={t(hasActiveFilter ? "list.noMatchesDescription" : "list.emptyDescription")}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <PageDirectoryFilters
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
      {deleteTarget && (
        <DeletePageDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          page={deleteTarget}
        />
      )}
    </>
  );
}
