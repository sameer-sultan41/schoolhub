"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { StructureStatusBadge } from "@/features/school/shared/structure-status";
import type { SchoolOrganizationOption, SubjectRecord } from "@/services";
import {
  DEFAULT_SUBJECT_TYPE,
  STRUCTURE_ACTIONS_COLUMN_ID,
} from "@/services/modules/school-organization/school-organization-constant";

/**
 * The subjects table's columns; sortable ids are the keys of `SUBJECT_SORT_FIELD`. The API sends
 * a subject's department as an id, so its name comes from `departments`. Memoized on its inputs.
 */
export function useSubjectColumns(
  departments: readonly SchoolOrganizationOption[] | undefined,
  canEdit: boolean,
  canRemove: boolean,
  onEdit: (record: SubjectRecord) => void,
  onRemove: (record: SubjectRecord) => void,
): ColumnDef<SubjectRecord>[] {
  const t = useTranslations("school");

  return useMemo<ColumnDef<SubjectRecord>[]>(
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
        accessorKey: "subject_type",
        enableSorting: false,
        header: () => t("subjects.fields.type"),
        cell: ({ row }) => t(`subjects.types.${row.original.subject_type ?? DEFAULT_SUBJECT_TYPE}`),
        meta: {
          headerTitle: t("subjects.fields.type"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "department",
        accessorKey: "department_id",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("subjects.fields.department")} />
        ),
        cell: ({ row }) => {
          const departmentId = row.original.department_id;
          if (!departmentId) return t("subjects.noDepartment");
          return (
            departments?.find((department) => department.id === departmentId)?.name ??
            t("subjects.unknownDepartment")
          );
        },
        meta: {
          headerTitle: t("subjects.fields.department"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
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
    [t, departments, canEdit, canRemove, onEdit, onRemove],
  );
}
