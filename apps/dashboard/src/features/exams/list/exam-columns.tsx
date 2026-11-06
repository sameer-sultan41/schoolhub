"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { examPath } from "@/config/paths";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { ExamRecord } from "@/services";
import { EXAMS_ACTIONS_COLUMN_ID } from "@/services/modules/exams/exams-constant";
import { isExamConfigurable, isExamDeletable } from "@/services/modules/exams/exams-helper";
import { ExamStatusBadge } from "@/features/exams/exam-status-badge";

export interface ExamRowActions {
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (record: ExamRecord) => void;
  onRemove: (record: ExamRecord) => void;
}

/**
 * The exams table's columns; ids are the keys of `EXAMS_SORT_FIELD` (name, dates), plus the
 * unsortable rest. Edit is offered up to `scheduled` and Delete on a `draft` only: past those the
 * exam's configuration is frozen on the server, so the button would only be refused. Memoized on
 * its inputs, so the caller passes `useCallback`-stable handlers.
 */
export function useExamColumns(actions: ExamRowActions): ColumnDef<ExamRecord>[] {
  const t = useTranslations("exams");
  const locale = useLocale();
  const { canUpdate, canDelete, onEdit, onRemove } = actions;

  return useMemo<ColumnDef<ExamRecord>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.name")} />,
        cell: ({ row }) => (
          <Link
            href={examPath(row.original.id)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
        meta: { headerTitle: t("columns.name"), skeleton: <Skeleton className="h-4 w-40" /> },
      },
      {
        id: "sessionTerm",
        enableSorting: false,
        header: () => t("columns.sessionTerm"),
        cell: ({ row }) =>
          row.original.term_name
            ? t("detail.sessionTerm", {
                session: row.original.academic_session_name,
                term: row.original.term_name,
              })
            : row.original.academic_session_name,
        meta: {
          headerTitle: t("columns.sessionTerm"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "type",
        enableSorting: false,
        header: () => t("columns.type"),
        cell: ({ row }) => t(`types.${row.original.exam_type}`),
        meta: { headerTitle: t("columns.type"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "dates",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("columns.dates")} />,
        cell: ({ row }) =>
          row.original.starts_on && row.original.ends_on
            ? t("detail.dates", {
                from: formatDate(row.original.starts_on, locale),
                to: formatDate(row.original.ends_on, locale),
              })
            : EMPTY_VALUE,
        meta: { headerTitle: t("columns.dates"), skeleton: <Skeleton className="h-4 w-40" /> },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("columns.status"),
        cell: ({ row }) => <ExamStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("columns.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: "subjects",
        enableSorting: false,
        header: () => t("columns.subjects"),
        cell: ({ row }) => row.original.subject_count.toLocaleString(locale),
        meta: { headerTitle: t("columns.subjects"), skeleton: <Skeleton className="h-4 w-8" /> },
      },
      {
        id: EXAMS_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          const canEdit = canUpdate && isExamConfigurable(record.status);
          const canRemove = canDelete && isExamDeletable(record.status);
          return (
            <RowEditRemoveActions
              editLabel={canEdit ? t("actions.editRow", { name: record.name }) : undefined}
              onEdit={() => {
                onEdit(record);
              }}
              removeLabel={canRemove ? t("actions.deleteRow", { name: record.name }) : undefined}
              onRemove={() => {
                onRemove(record);
              }}
            />
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-16" /> },
      },
    ],
    [t, locale, canUpdate, canDelete, onEdit, onRemove],
  );
}
