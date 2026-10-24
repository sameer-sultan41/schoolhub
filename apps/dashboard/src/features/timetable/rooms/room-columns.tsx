"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, BadgeDot, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { EMPTY_VALUE } from "@/lib/constants";
import type { RoomRecord } from "@/services";
import {
  DEFAULT_ROOM_TYPE,
  ROOMS_ACTIONS_COLUMN_ID,
} from "@/services/modules/rooms/rooms-constant";
import { roomLocation } from "@/services/modules/rooms/rooms-helper";

/**
 * The rooms table's columns; ids are the keys of `ROOMS_SORT_FIELD`, plus the unsortable
 * `location` (building and floor joined). Memoized on its inputs, so callers pass
 * `useCallback`-stable handlers.
 */
export function useRoomColumns(
  canEdit: boolean,
  canRemove: boolean,
  onEdit: (record: RoomRecord) => void,
  onRemove: (record: RoomRecord) => void,
): ColumnDef<RoomRecord>[] {
  const t = useTranslations("timetable");

  return useMemo<ColumnDef<RoomRecord>[]>(
    () => [
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.code")} />,
        meta: { headerTitle: t("fields.code"), skeleton: <Skeleton className="h-4 w-12" /> },
      },
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.name")} />,
        meta: { headerTitle: t("fields.name"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "type",
        accessorKey: "room_type",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.roomType")} />
        ),
        cell: ({ row }) => t(`rooms.types.${row.original.room_type ?? DEFAULT_ROOM_TYPE}`),
        meta: { headerTitle: t("fields.roomType"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "capacity",
        accessorKey: "capacity",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.capacity")} />
        ),
        cell: ({ row }) => row.original.capacity?.toLocaleString() ?? EMPTY_VALUE,
        meta: { headerTitle: t("fields.capacity"), skeleton: <Skeleton className="h-4 w-8" /> },
      },
      {
        id: "location",
        enableSorting: false,
        header: () => t("rooms.columns.location"),
        cell: ({ row }) => roomLocation(row.original) || EMPTY_VALUE,
        meta: {
          headerTitle: t("rooms.columns.location"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "campus",
        accessorKey: "campus_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.campus")} />,
        meta: { headerTitle: t("fields.campus"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "status",
        accessorKey: "is_active",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.status")} />,
        cell: ({ row }) =>
          row.original.is_active === false ? (
            <Badge variant="secondary" appearance="light">
              <BadgeDot />
              {t("rooms.inactive")}
            </Badge>
          ) : (
            <Badge variant="success" appearance="light">
              <BadgeDot />
              {t("rooms.active")}
            </Badge>
          ),
        meta: {
          headerTitle: t("fields.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: ROOMS_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <RowEditRemoveActions
              editLabel={canEdit ? t("rooms.actions.editRow", { name: record.name }) : undefined}
              onEdit={() => {
                onEdit(record);
              }}
              removeLabel={
                canRemove ? t("rooms.actions.deleteRow", { name: record.name }) : undefined
              }
              onRemove={() => {
                onRemove(record);
              }}
            />
          );
        },
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, canEdit, canRemove, onEdit, onRemove],
  );
}
