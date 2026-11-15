"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { StructureStatusBadge } from "@/features/school/shared/structure-status";
import { EMPTY_VALUE } from "@/lib/constants";
import { Regex } from "@/lib/regex";
import type { HouseRecord } from "@/services";
import { STRUCTURE_ACTIONS_COLUMN_ID } from "@/services/modules/school-organization/school-organization-constant";

/** A house's colour: a swatch of the stored hex beside it. The colour is the school's own data,
 * so it is an inline style, not a theme token. */
function HouseColor({ color }: { color: string | null | undefined }) {
  if (!color) return EMPTY_VALUE;
  return (
    <span className="inline-flex items-center gap-2">
      {Regex.HEX_COLOR.test(color) ? (
        <span
          aria-hidden="true"
          className="size-3.5 rounded-full border border-border"
          style={{ backgroundColor: color }}
        />
      ) : null}
      {color}
    </span>
  );
}

/** The houses table's columns; sortable ids are the keys of `HOUSE_SORT_FIELD`. */
export function useHouseColumns(
  canEdit: boolean,
  canRemove: boolean,
  onEdit: (record: HouseRecord) => void,
  onRemove: (record: HouseRecord) => void,
): ColumnDef<HouseRecord>[] {
  const t = useTranslations("school");

  return useMemo<ColumnDef<HouseRecord>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.name")} />,
        meta: { headerTitle: t("fields.name"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.code")} />,
        cell: ({ row }) => row.original.code ?? EMPTY_VALUE,
        meta: { headerTitle: t("fields.code"), skeleton: <Skeleton className="h-4 w-12" /> },
      },
      {
        id: "color",
        enableSorting: false,
        header: () => t("houses.fields.color"),
        cell: ({ row }) => <HouseColor color={row.original.color} />,
        meta: {
          headerTitle: t("houses.fields.color"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "motto",
        enableSorting: false,
        header: () => t("houses.fields.motto"),
        cell: ({ row }) => row.original.motto ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("houses.fields.motto"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("fields.status"),
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
