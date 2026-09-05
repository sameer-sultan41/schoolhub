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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@schoolhub/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Can } from "@/components/can";
import { RoomForm } from "@/features/timetable/room-form";
import { ALL, ROOM_TYPES, TIMETABLE_PAGE_SIZE } from "@/features/timetable/timetable-constants";
import { ApiErrorAlert } from "@/features/timetable/timetable-error-alert";
import { TimetableNav } from "@/features/timetable/timetable-nav";
import type { RoomRecord } from "@/features/timetable/timetable-types";
import { useCampusOptions } from "@/features/timetable/use-timetable-reference-data";
import { useCursorPager } from "@/hooks/use-cursor-pager";
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
  const [campusId, setCampusId] = useState<string>(ALL);
  const [roomType, setRoomType] = useState<string>(ALL);

  const filters = useMemo(
    () => ({
      ...(campusId !== ALL ? { campus_id: campusId } : {}),
      ...(roomType !== ALL ? { room_type: roomType } : {}),
    }),
    [campusId, roomType],
  );
  pager.syncFilterKey(JSON.stringify(filters));

  const { data, isPending, isFetching, error } = useQuery({
    queryKey: queryKeys.list("timetable", "rooms", { ...filters, cursor: pager.cursor }),
    queryFn: () =>
      fetchPage<RoomRecord>(apiClient, "/rooms", {
        query: {
          ...filters,
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
          page_size: TIMETABLE_PAGE_SIZE,
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
    { id: "code", header: t("fields.code"), cell: (row) => row.code },
    { id: "name", header: t("fields.name"), cell: (row) => row.name },
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.campus")}</span>
          <Select value={campusId} onValueChange={setCampusId}>
            <SelectTrigger aria-label={t("fields.campus")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {(campuses.data ?? []).map((campus) => (
                <SelectItem key={campus.id} value={campus.id}>
                  {campus.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-48 space-y-1">
          <span className="text-xs font-medium text-muted-foreground">{t("fields.roomType")}</span>
          <Select value={roomType} onValueChange={setRoomType}>
            <SelectTrigger aria-label={t("fields.roomType")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
              {ROOM_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`rooms.types.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <ApiErrorAlert error={error} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          caption={t("rooms.list.caption")}
          isLoading={isPending}
          emptyState={t("rooms.list.empty")}
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
          }}
        />
      )}
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
