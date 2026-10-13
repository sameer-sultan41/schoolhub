"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, BadgeDot, Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";
import { Pencil, Trash2 } from "lucide-react";

import type { CurriculumRecord } from "@/services";
import { CURRICULUM_ACTIONS_COLUMN_ID } from "@/services/modules/curriculum/curriculum-constant";

/**
 * The curriculum table's column defs. Column ids are the keys of `CURRICULUM_SORT_FIELD`.
 * Memoized on its real inputs, so the callers pass `useCallback`-stable handlers: an inline
 * arrow would rebuild every cell on each search keystroke or page change.
 *
 * The table hides the whole `actions` column for a locked session, so these flags are only
 * about the viewer's permissions.
 */
export function useCurriculumColumns(
  canEdit: boolean,
  canRemove: boolean,
  onEdit: (record: CurriculumRecord) => void,
  onRemove: (record: CurriculumRecord) => void,
): ColumnDef<CurriculumRecord>[] {
  const t = useTranslations("academics");

  return useMemo<ColumnDef<CurriculumRecord>[]>(
    () => [
      {
        id: "class",
        accessorKey: "class_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.class")} />,
        meta: { headerTitle: t("fields.class"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "subject",
        accessorKey: "subject_name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.subject")} />
        ),
        meta: { headerTitle: t("fields.subject"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "campus",
        accessorKey: "campus_name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.campus")} />,
        // A null campus means the mapping applies to every campus.
        cell: ({ row }) => row.original.campus_name ?? t("fields.allCampuses"),
        meta: { headerTitle: t("fields.campus"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "kind",
        accessorKey: "is_elective",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("curriculum.columns.kind")} />
        ),
        // Soft, with a dot: one solid pill per row down a column reads as a wall of colour,
        // and the dot keeps the two kinds apart without leaning on hue alone.
        cell: ({ row }) =>
          row.original.is_elective ? (
            <Badge variant="warning" appearance="light">
              <BadgeDot />
              {row.original.elective_group
                ? t("curriculum.electiveWithGroup", { group: row.original.elective_group })
                : t("curriculum.elective")}
            </Badge>
          ) : (
            <Badge variant="secondary" appearance="light">
              <BadgeDot />
              {t("curriculum.core")}
            </Badge>
          ),
        meta: {
          headerTitle: t("curriculum.columns.kind"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: "weeklyPeriods",
        accessorKey: "weekly_periods",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.weeklyPeriods")} />
        ),
        meta: {
          headerTitle: t("fields.weeklyPeriods"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: CURRICULUM_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          const labelValues = { subject: record.subject_name, className: record.class_name };
          return (
            <div className="flex items-center gap-1">
              {canEdit && (
                <Button
                  variant="primary"
                  appearance="light"
                  mode="icon"
                  shape="circle"
                  size="sm"
                  aria-label={t("curriculum.actions.editRow", labelValues)}
                  onClick={() => {
                    onEdit(record);
                  }}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
              )}
              {canRemove && (
                <Button
                  variant="destructive"
                  appearance="light"
                  mode="icon"
                  shape="circle"
                  size="sm"
                  aria-label={t("curriculum.actions.deleteRow", labelValues)}
                  onClick={() => {
                    onRemove(record);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, canEdit, canRemove, onEdit, onRemove],
  );
}
