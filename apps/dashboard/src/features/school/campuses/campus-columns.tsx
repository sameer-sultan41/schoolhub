"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { EMPTY_VALUE } from "@/lib/constants";
import type { CampusRecord } from "@/services";
import { STRUCTURE_ACTIONS_COLUMN_ID } from "@/services/modules/school-organization/school-organization-constant";
import { StructureStatusBadge } from "@/features/school/shared/structure-status";

/** The campuses table's columns; sortable ids are the keys of `CAMPUS_SORT_FIELD`. Memoized on
 * its inputs, so callers pass `useCallback`-stable handlers. */
export function useCampusColumns(
  canEdit: boolean,
  canRemove: boolean,
  onEdit: (record: CampusRecord) => void,
  onRemove: (record: CampusRecord) => void,
): ColumnDef<CampusRecord>[] {
  const t = useTranslations("school");

  return useMemo<ColumnDef<CampusRecord>[]>(
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
        id: "primary",
        accessorKey: "is_primary",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("campuses.columns.primary")} />
        ),
        cell: ({ row }) =>
          row.original.is_primary ? (
            <Badge variant="primary" appearance="light">
              {t("campuses.primary")}
            </Badge>
          ) : (
            EMPTY_VALUE
          ),
        meta: {
          headerTitle: t("campuses.columns.primary"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "contact",
        enableSorting: false,
        header: () => t("campuses.columns.contact"),
        cell: ({ row }) =>
          [row.original.phone, row.original.email].filter(Boolean).join(" · ") || EMPTY_VALUE,
        meta: {
          headerTitle: t("campuses.columns.contact"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "status",
        accessorKey: "is_active",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.status")} />,
        cell: ({ row }) => <StructureStatusBadge isActive={row.original.is_active} />,
        meta: {
          headerTitle: t("fields.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: STRUCTURE_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <RowEditRemoveActions
              editLabel={canEdit ? t("actions.editRow", { name: record.name }) : undefined}
              onEdit={() => {
                onEdit(record);
              }}
              removeLabel={canRemove ? t("actions.removeRow", { name: record.name }) : undefined}
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
