"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, cn, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";
import { ChevronRight } from "lucide-react";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { StructureStatusBadge } from "@/features/school/shared/structure-status";
import type { ClassRecord } from "@/services";
import {
  CLASS_SECTIONS_COLUMN_ID,
  STRUCTURE_ACTIONS_COLUMN_ID,
} from "@/services/modules/school-organization/school-organization-constant";
import { ClassSectionsPanel, type SectionPermissions } from "./class-sections-panel";

export interface ClassColumnPermissions {
  canEdit: boolean;
  canRemove: boolean;
  sections: SectionPermissions;
}

/**
 * The classes table's columns; sortable ids are the keys of `CLASS_SORT_FIELD`. The first
 * column opens a row onto the class's sections. Memoized on its inputs.
 */
export function useClassColumns(
  { canEdit, canRemove, sections }: ClassColumnPermissions,
  onEdit: (record: ClassRecord) => void,
  onRemove: (record: ClassRecord) => void,
): ColumnDef<ClassRecord>[] {
  const t = useTranslations("school");

  return useMemo<ColumnDef<ClassRecord>[]>(
    () => [
      {
        id: CLASS_SECTIONS_COLUMN_ID,
        header: () => <span className="sr-only">{t("sections.title")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            mode="icon"
            size="sm"
            aria-expanded={row.getIsExpanded()}
            aria-label={t(row.getIsExpanded() ? "sections.hide" : "sections.show", {
              name: row.original.name,
            })}
            onClick={row.getToggleExpandedHandler()}
          >
            <ChevronRight
              className={cn(
                "size-4 transition-transform",
                row.getIsExpanded() ? "rotate-90" : "rtl:rotate-180",
              )}
              aria-hidden="true"
            />
          </Button>
        ),
        meta: {
          headerTitle: t("sections.title"),
          skeleton: <Skeleton className="size-7 rounded-md" />,
          expandedContent: (record) => (
            <ClassSectionsPanel schoolClass={record} permissions={sections} />
          ),
        },
      },
      {
        id: "level",
        accessorKey: "level",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("classes.fields.level")} />
        ),
        meta: {
          headerTitle: t("classes.fields.level"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.name")} />,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        meta: { headerTitle: t("fields.name"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.code")} />,
        meta: { headerTitle: t("fields.code"), skeleton: <Skeleton className="h-4 w-12" /> },
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
    [t, canEdit, canRemove, sections, onEdit, onRemove],
  );
}
