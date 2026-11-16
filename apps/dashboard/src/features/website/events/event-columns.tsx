"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import {
  editColumn,
  statusColumn,
  titleColumn,
  updatedColumn,
} from "@/features/website/shared/content-columns";
import { EMPTY_VALUE } from "@/lib/constants";
import type { SchoolEventRecord } from "@/services";
import { useEventWhen } from "./use-event-when";

export interface EventColumnsOptions {
  /** `website.school-event.update`: the row's Edit. */
  canUpdate: boolean;
  onOpen: (event: SchoolEventRecord) => void;
  onEdit: (event: SchoolEventRecord) => void;
}

/**
 * The events directory's columns: the title (opening the detail sheet, where the lifecycle
 * lives), status, when (sorted by its start), where, the last change, and the row's Edit.
 */
export function useEventColumns({
  canUpdate,
  onOpen,
  onEdit,
}: EventColumnsOptions): ColumnDef<SchoolEventRecord>[] {
  const t = useTranslations("website.events");
  const when = useEventWhen();

  return useMemo<ColumnDef<SchoolEventRecord>[]>(
    () => [
      titleColumn(t("columns.title"), onOpen),
      statusColumn(t("columns.status")),
      {
        id: "starts_at",
        accessorKey: "starts_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("columns.startsAt")} />
        ),
        cell: ({ row }) => when(row.original),
        meta: { headerTitle: t("columns.startsAt"), skeleton: <Skeleton className="h-4 w-32" /> },
      },
      {
        id: "location",
        enableSorting: false,
        header: () => t("columns.location"),
        cell: ({ row }) => row.original.location || EMPTY_VALUE,
        meta: { headerTitle: t("columns.location"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      updatedColumn(t("columns.updatedAt")),
      editColumn({
        canUpdate,
        label: t("actions.edit"),
        rowLabel: (event) => t("actions.editRow", { title: event.title }),
        onEdit,
      }),
    ],
    [t, when, canUpdate, onOpen, onEdit],
  );
}
