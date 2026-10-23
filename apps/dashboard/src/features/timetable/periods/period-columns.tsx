"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, BadgeDot, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import type { PeriodRecord } from "@/services";
import { PERIODS_ACTIONS_COLUMN_ID } from "@/services/modules/periods/periods-constant";
import { periodWeekdays, toShortTime } from "@/services/modules/periods/periods-helper";
import { PeriodWeekdays } from "./period-weekdays";

/**
 * The bell-schedule table's columns; ids are the keys of `PERIODS_SORT_FIELD`, plus the
 * unsortable `weekdays`. Memoized on its inputs, so callers pass `useCallback`-stable handlers.
 */
export function usePeriodColumns(
  canEdit: boolean,
  canRemove: boolean,
  onEdit: (record: PeriodRecord) => void,
  onRemove: (record: PeriodRecord) => void,
): ColumnDef<PeriodRecord>[] {
  const t = useTranslations("timetable");

  return useMemo<ColumnDef<PeriodRecord>[]>(
    () => [
      {
        id: "sequence",
        accessorKey: "sequence",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.sequence")} />
        ),
        meta: { headerTitle: t("fields.sequence"), skeleton: <Skeleton className="h-4 w-6" /> },
      },
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.name")} />,
        meta: { headerTitle: t("fields.name"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "time",
        accessorKey: "start_time",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("periods.columns.time")} />
        ),
        cell: ({ row }) =>
          `${toShortTime(row.original.start_time)}–${toShortTime(row.original.end_time)}`,
        meta: {
          headerTitle: t("periods.columns.time"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "kind",
        accessorKey: "is_break",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("periods.columns.kind")} />
        ),
        cell: ({ row }) =>
          row.original.is_break ? (
            <Badge variant="warning" appearance="light">
              <BadgeDot />
              {t("periods.break")}
            </Badge>
          ) : (
            <Badge variant="secondary" appearance="light">
              <BadgeDot />
              {t("periods.teaching")}
            </Badge>
          ),
        meta: {
          headerTitle: t("periods.columns.kind"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: "weekdays",
        enableSorting: false,
        header: () => t("fields.weekdays"),
        cell: ({ row }) => <PeriodWeekdays weekdays={periodWeekdays(row.original)} />,
        meta: { headerTitle: t("fields.weekdays"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "campus",
        accessorKey: "campus_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.campus")} />,
        // A null campus means the period runs at every campus.
        cell: ({ row }) => row.original.campus_name ?? t("fields.allCampuses"),
        meta: { headerTitle: t("fields.campus"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: PERIODS_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <RowEditRemoveActions
              editLabel={canEdit ? t("periods.actions.editRow", { name: record.name }) : undefined}
              onEdit={() => {
                onEdit(record);
              }}
              removeLabel={
                canRemove ? t("periods.actions.deleteRow", { name: record.name }) : undefined
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
