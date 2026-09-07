"use client";

import { fetchPage } from "@schoolhub/api-client";
import { isOffsetPagination } from "@schoolhub/types";
import {
  Badge,
  BadgeDot,
  Button,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Skeleton,
} from "@schoolhub/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ApiErrorAlert } from "@/components/api-error-alert";
import { Can } from "@/components/can";
import { FilterBar } from "@/components/filter-bar";
import { RoomForm } from "@/features/timetable/room-form";
import { ALL, ROOM_TYPES, TIMETABLE_PAGE_SIZE } from "@/features/timetable/timetable-constants";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import type { RoomRecord } from "@/features/timetable/timetable-types";
import { useCampusOptions } from "@/features/timetable/use-timetable-reference-data";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

/** A badge column's placeholder. A pill rather than the default text bar, so the row
 * keeps its shape when the real chip arrives. */
const BADGE_SKELETON = <Skeleton className="h-5 w-20 rounded-full" />;

/** Rooms (§5.4): type and capacity, which the conflict engine reads when it warns
 * that a section will not fit. */
export function RoomsScreen() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");

  const campuses = useCampusOptions();
  const table = useTableParams({
    filterKeys: ["campus_id", "room_type"],
    pageSize: TIMETABLE_PAGE_SIZE,
    sortLabels: {
      ascending: (column) => tCommon("sortAscending", { column }),
      descending: (column) => tCommon("sortDescending", { column }),
    },
  });
  const campusId = table.filter("campus_id");
  const roomType = table.filter("room_type");

  // Carries `page` already, whenever the reader is past the first one, so the request
  // and the cache key both follow the pager without either of them restating it.
  const filters = table.query;

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.list("timetable", "rooms", filters),
    queryFn: () => fetchPage<RoomRecord>(apiClient, "/rooms", { query: filters }),
    placeholderData: keepPreviousData,
  });

  const campusNames = useMemo(
    () => new Map((campuses.data ?? []).map((campus) => [campus.id, campus.name])),
    [campuses.data],
  );

  const rows = data?.items ?? [];
  // `/rooms` pages by number, not by cursor (views.RoomViewSet.pagination_class), so the
  // envelope carries `page`/`total_pages`. Narrowing to the other arm — which this screen
  // used to do — leaves `hasNext` permanently false and the list stuck on page one.
  const pagination =
    data?.pagination && isOffsetPagination(data.pagination) ? data.pagination : undefined;

  // The pager reads the URL, never the envelope: with `placeholderData` the envelope
  // still describes the page being replaced, so a number taken from it would lag a click
  // by a whole request. The range below comes from that same URL state so the two can
  // never disagree; only `total_count` has to come from the server.
  const pageSize = pagination?.page_size ?? table.pageSize;
  const totalCount = pagination?.total_count ?? 0;
  // Guarded rather than a bare `(page - 1) * size + 1`, which would read "1–0 of 0" on
  // an empty list.
  const firstRowOnPage = totalCount === 0 ? 0 : (table.page - 1) * pageSize + 1;
  const lastRowOnPage = Math.min(table.page * pageSize, totalCount);

  // Every sortKey below is an entry in RoomViewSet.ordering_fields, which covers each
  // rendered column except `location`: that cell joins building and floor, and the
  // endpoint deliberately offers no `building` ordering because sorting on half of a
  // displayed value orders the rows by something other than what the header names.
  const columns: DataTableColumn<RoomRecord>[] = [
    {
      id: "code",
      header: t("fields.code"),
      sortKey: "code",
      cell: (row) => row.code,
      skeleton: <Skeleton className="h-4 w-16" />,
    },
    {
      id: "name",
      header: t("fields.name"),
      sortKey: "name",
      cell: (row) => row.name,
      skeleton: <Skeleton className="h-4 w-32" />,
    },
    {
      id: "type",
      header: t("fields.roomType"),
      sortKey: "room_type",
      // A category, not a status: the neutral chip, so it reads as a label rather than
      // as a state the reader is meant to act on.
      cell: (row) => (
        <Badge variant="outline" appearance="soft">
          {t(`rooms.types.${row.room_type}`)}
        </Badge>
      ),
      skeleton: BADGE_SKELETON,
    },
    {
      id: "campus",
      header: t("fields.campus"),
      sortKey: "campus_name",
      cell: (row) => campusNames.get(row.campus_id) ?? EMPTY,
      skeleton: <Skeleton className="h-4 w-28" />,
    },
    {
      id: "capacity",
      header: t("fields.capacity"),
      sortKey: "capacity",
      // A quantity read down the column and compared, so the table owns the treatment:
      // figures face, tabular digits, and ranged to the end. `className: "tabular-nums"`
      // was half of that hand-rolled.
      numeric: "measure",
      cell: (row) => row.capacity ?? EMPTY,
      // `ms-auto` because the loading row does not carry the column's alignment — the
      // placeholder has to sit where the figure will.
      skeleton: <Skeleton className="h-4 w-10" />,
    },
    {
      id: "location",
      header: t("rooms.columns.location"),
      cell: (row) => [row.building, row.floor].filter(Boolean).join(" · ") || EMPTY,
      skeleton: <Skeleton className="h-4 w-24" />,
    },
    {
      id: "status",
      header: t("fields.status"),
      sortKey: "is_active",
      // Soft, with a dot: one solid pill on every row of a status column is a wall of
      // colour, and the dot keeps the state legible without relying on the fill.
      cell: (row) =>
        row.is_active ? (
          <Badge variant="success" appearance="soft">
            <BadgeDot />
            {t("rooms.active")}
          </Badge>
        ) : (
          <Badge variant="secondary" appearance="soft">
            <BadgeDot />
            {t("rooms.inactive")}
          </Badge>
        ),
      skeleton: BADGE_SKELETON,
    },
    {
      id: "actions",
      header: "",
      srLabel: t("rooms.columns.actions"),
      className: "text-end",
      // Never offered in the columns menu: hiding it leaves rows a reader can look at
      // and not act on, with the menu that hid it as the only way back.
      alwaysVisible: true,
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Can permission="timetable.room.update">
            <RoomForm room={row} />
          </Can>
          <Can permission="timetable.room.delete">
            <DeleteRoomDialog room={row} />
          </Can>
        </div>
      ),
      skeleton: (
        <div className="flex justify-end gap-2">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <TimetableNav />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Can permission="timetable.room.create">
          <RoomForm />
        </Can>
      </div>

      <DataTable
        toolbar={
          <FilterBar
            selects={[
              {
                id: "campus",
                label: t("fields.campus"),
                value: campusId,
                onChange: (value) => {
                  table.setFilter("campus_id", value);
                },
                options: (campuses.data ?? []).map((campus) => ({
                  value: campus.id,
                  label: campus.name,
                })),
                allLabel: t("filters.all"),
                allValue: ALL,
                className: "w-48",
              },
              {
                id: "roomType",
                label: t("fields.roomType"),
                value: roomType,
                onChange: (value) => {
                  table.setFilter("room_type", value);
                },
                options: ROOM_TYPES.map((value) => ({ value, label: t(`rooms.types.${value}`) })),
                allLabel: t("filters.all"),
                allValue: ALL,
                className: "w-48",
              },
            ]}
            clearLabel={tCommon("clearFilters")}
            onClear={table.clear}
          />
        }
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        caption={t("rooms.list.caption")}
        isLoading={isPending}
        error={error ? <ApiErrorAlert error={error} /> : undefined}
        emptyState={
          <EmptyState
            icon={DoorOpen}
            title={t("rooms.list.emptyTitle")}
            description={t("rooms.list.emptyDescription")}
            action={
              <Can permission="timetable.room.create">
                <RoomForm />
              </Can>
            }
          />
        }
        sort={table.sort}
        columnVisibility={{
          hidden: table.hiddenColumns,
          onChange: table.setHiddenColumns,
          triggerLabel: tCommon("columns"),
          title: tCommon("toggleColumns"),
        }}
        pagination={{
          mode: "pages",
          page: table.page,
          // 0 until the first response lands, which is what leaves the pager absent
          // under the loading skeleton rather than showing a lone disabled "1".
          totalPages: pagination?.total_pages ?? 0,
          onPageChange: table.setPage,
          label: tCommon("pagination"),
          previousLabel: tCommon("previousPage"),
          nextLabel: tCommon("nextPage"),
          goToPageLabel: (page) => tCommon("goToPage", { page }),
          morePagesLabel: tCommon("morePages"),
          pageSize: {
            value: table.pageSize,
            options: [25, 50, 100],
            onChange: table.setPageSize,
            label: tCommon("rowsPerPage"),
          },
          // "1–25 of 84" rather than the nothing this showed under cursor paging: with a
          // page number on screen, where the reader is in the list is finally a fact the
          // summary can state.
          // Suppressed on an empty result: the range would read "1–0 of 0" beneath an
          // empty state that has already said there is nothing here.
          summary:
            pagination && pagination.total_count > 0
              ? tCommon("pageRange", {
                  from: firstRowOnPage,
                  to: lastRowOnPage,
                  count: pagination.total_count,
                })
              : null,
        }}
      />
    </div>
  );
}

/**
 * `timetable_slots.room` and `sections.room_id` are both `on_delete=PROTECT`, so
 * a room in use cannot be removed — the API answers 409. Deactivating is usually
 * what the user actually wants, which is why the dialog says so.
 */
function DeleteRoomDialog({ room }: { room: RoomRecord }) {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => apiClient.delete(`/rooms/${room.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.module("timetable") });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          {t("rooms.actions.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("rooms.delete.title")}</DialogTitle>
          <DialogDescription>{t("rooms.delete.description")}</DialogDescription>
        </DialogHeader>

        <ApiErrorAlert error={mutation.error} />

        <DialogFooter>
          <Button
            variant="danger"
            isLoading={mutation.isPending}
            loadingLabel={tCommon("loading")}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {t("rooms.actions.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
