"use client";

import { fetchPage } from "@schoolhub/api-client";
import { isCursorPagination } from "@schoolhub/types";
import {
  Badge,
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
import { useCursorPager } from "@/hooks/use-cursor-pager";
import { useTableParams } from "@/hooks/use-table-params";
import { apiClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-client";

const EMPTY = "—";

/** Rooms (§5.4): type and capacity, which the conflict engine reads when it warns
 * that a section will not fit. */
export function RoomsScreen() {
  const t = useTranslations("timetable");
  const tCommon = useTranslations("common");
  const pager = useCursorPager();

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

  const filters = table.query;
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("timetable", "rooms", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<RoomRecord>(apiClient, "/rooms", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });

  const campusNames = useMemo(
    () => new Map((campuses.data ?? []).map((campus) => [campus.id, campus.name])),
    [campuses.data],
  );

  const rows = data?.items ?? [];
  const pagination =
    data?.pagination && isCursorPagination(data.pagination) ? data.pagination : undefined;

  const columns: DataTableColumn<RoomRecord>[] = [
    { id: "code", header: t("fields.code"), cell: (row) => row.code, sortKey: "code" },
    { id: "name", header: t("fields.name"), cell: (row) => row.name, sortKey: "name" },
    {
      id: "type",
      header: t("fields.roomType"),
      cell: (row) => t(`rooms.types.${row.room_type}`),
    },
    {
      id: "campus",
      header: t("fields.campus"),
      cell: (row) => campusNames.get(row.campus_id) ?? EMPTY,
    },
    {
      id: "capacity",
      sortKey: "capacity",
      header: t("fields.capacity"),
      className: "tabular-nums",
      cell: (row) => row.capacity ?? EMPTY,
    },
    {
      id: "location",
      header: t("rooms.columns.location"),
      cell: (row) => [row.building, row.floor].filter(Boolean).join(" · ") || EMPTY,
    },
    {
      id: "status",
      header: t("fields.status"),
      cell: (row) =>
        row.is_active ? (
          <Badge variant="success">{t("rooms.active")}</Badge>
        ) : (
          <Badge variant="secondary">{t("rooms.inactive")}</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      srLabel: t("rooms.columns.actions"),
      className: "text-end",
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

      <DataTable
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
        pagination={{
          hasNext: Boolean(pagination?.next_cursor),
          hasPrevious: pager.hasPrevious,
          onNext: () => {
            if (!isFetching) pager.onNext(pagination);
          },
          onPrevious: () => {
            if (!isFetching) pager.onPrevious();
          },
          nextLabel: tCommon("next"),
          previousLabel: tCommon("previous"),
          pageSize: {
            value: table.pageSize,
            options: [25, 50, 100],
            onChange: table.setPageSize,
            label: tCommon("rowsPerPage"),
          },
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
