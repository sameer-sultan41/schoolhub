"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { StructureStatusBadge } from "@/features/school/shared/structure-status";
import type { DepartmentRecord, SchoolOrganizationOption } from "@/services";
import {
  DEFAULT_DEPARTMENT_TYPE,
  STRUCTURE_ACTIONS_COLUMN_ID,
} from "@/services/modules/school-organization/school-organization-constant";

/**
 * The departments table's columns; sortable ids are the keys of `DEPARTMENT_SORT_FIELD`. The
 * API sends a department's campus as an id, so its name comes from `campuses`; a department
 * with none spans every campus. Memoized on its inputs.
 */
export function useDepartmentColumns(
  campuses: readonly SchoolOrganizationOption[] | undefined,
  canEdit: boolean,
  canRemove: boolean,
  onEdit: (record: DepartmentRecord) => void,
  onRemove: (record: DepartmentRecord) => void,
): ColumnDef<DepartmentRecord>[] {
  const t = useTranslations("school");

  return useMemo<ColumnDef<DepartmentRecord>[]>(
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
        accessorKey: "department_type",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("departments.fields.type")} />
        ),
        cell: ({ row }) =>
          t(`departments.types.${row.original.department_type ?? DEFAULT_DEPARTMENT_TYPE}`),
        meta: {
          headerTitle: t("departments.fields.type"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "campus",
        accessorKey: "campus_id",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.campus")} />,
        cell: ({ row }) => {
          const campusId = row.original.campus_id;
          if (!campusId) return t("allCampuses");
          return campuses?.find((campus) => campus.id === campusId)?.name ?? t("unknownCampus");
        },
        meta: { headerTitle: t("fields.campus"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "status",
        accessorKey: "is_active",
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
    [t, campuses, canEdit, canRemove, onEdit, onRemove],
  );
}
