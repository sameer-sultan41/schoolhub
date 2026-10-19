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
import { DoorOpen } from "lucide-react";
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
import { Services, type RoomRecord } from "@/services";
import {
  ROOMS_ACTIONS_COLUMN_ID,
  ROOMS_DEFAULT_SORTING,
  ROOMS_LIST_RESOURCE,
  ROOMS_QUERY_MODULE,
  ROOMS_SORT_FIELD,
  ROOMS_SORTABLE_IDS,
  ROOMS_URL_FILTERS,
  ROOM_STATUS,
} from "@/services/modules/rooms/rooms-constant";
import { statusToIsActive, typeFilterToRoomType } from "@/services/modules/rooms/rooms-helper";
import { DeleteRoomDialog } from "./delete-room-dialog";
import { RoomFilters } from "./room-filters";
import { RoomFormDialog } from "./room-form-dialog";
import { useRoomColumns } from "./room-columns";

/**
 * The `/timetable/rooms` list: the tenant's rooms, server paginated, sorted and searched
 * through `Services.rooms.fetchRoomPage`, with its edit and remove dialogs. The
 * view state lives in the URL (`useDataGridUrlState`); each dialog is mounted only while open.
 */
export function RoomsTable() {
  const t = useTranslations("timetable");
  const tErrors = useTranslations("errors");

  const [editTarget, setEditTarget] = useState<RoomRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoomRecord | null>(null);

  const { data: currentUser } = useCurrentUser();
  const canUpdate = hasPermission(currentUser, "timetable.room.update");
  const canDelete = hasPermission(currentUser, "timetable.room.delete");

  // Stable, so the columns' own `useMemo` skips a rebuild on a keystroke or a page change.
  const handleEdit = useCallback((record: RoomRecord) => {
    setEditTarget(record);
  }, []);
  const handleRemove = useCallback((record: RoomRecord) => {
    setDeleteTarget(record);
  }, []);

  const columns = useRoomColumns(canUpdate, canDelete, handleEdit, handleRemove);
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
    filters: ROOMS_URL_FILTERS,
    sortableIds: ROOMS_SORTABLE_IDS,
    defaultSorting: ROOMS_DEFAULT_SORTING,
    hideableIds,
    trimSearch: true,
  });

  const hasActiveFilter =
    search !== "" ||
    filters.campus !== "" ||
    filters.type !== FILTER_ALL ||
    filters.status !== ROOM_STATUS.all;

  const ordering = toOrdering(sorting, ROOMS_SORT_FIELD);
  const page = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;
  const roomType = typeFilterToRoomType(filters.type);
  const isActive = statusToIsActive(filters.status);

  const query = useQuery({
    queryKey: queryKeys.list(ROOMS_QUERY_MODULE, ROOMS_LIST_RESOURCE, {
      page,
      pageSize,
      search,
      ordering,
      campusId: filters.campus,
      roomType,
      isActive,
    }),
    queryFn: () =>
      Services.rooms.fetchRoomPage({
        page,
        pageSize,
        search: search || undefined,
        ordering,
        campusId: filters.campus || undefined,
        roomType,
        isActive,
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

  const showActions = canUpdate || canDelete;
  const visibility = useMemo(
    () => ({ ...columnVisibility, [ROOMS_ACTIONS_COLUMN_ID]: showActions }),
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

  if (query.isError && !isStalePage) {
    return (
      <LoadErrorCard
        message={resolveErrorMessage(query.error, tErrors, t("rooms.list.loadError"))}
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
        caption={t("rooms.list.caption")}
        tableLayout={{ cellBorder: true, columnsVisibility: true }}
        labels={DASHBOARD_DATA_GRID_LABELS}
        emptyState={
          <EmptyState
            icon={DoorOpen}
            title={t(hasActiveFilter ? "rooms.list.noMatches" : "rooms.list.emptyTitle")}
            description={t(
              hasActiveFilter ? "rooms.list.noMatchesDescription" : "rooms.list.emptyDescription",
            )}
          />
        }
      >
        <Card className={DATA_GRID_CARD_CLASSNAME}>
          <CardHeader className="flex flex-wrap items-center gap-2.5 py-3.5">
            <CardHeading>
              <div className="flex flex-wrap items-center gap-2.5">
                <RoomFilters
                  searchInput={searchInput}
                  onSearchInputChange={setSearchInput}
                  campusId={filters.campus}
                  onCampusIdChange={(campusId) => {
                    setFilters({ campus: campusId });
                  }}
                  type={filters.type}
                  onTypeChange={(type) => {
                    setFilters({ type });
                  }}
                  status={filters.status}
                  onStatusChange={(status) => {
                    setFilters({ status });
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
        <RoomFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          record={editTarget}
        />
      )}
      {deleteTarget && (
        <DeleteRoomDialog
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
