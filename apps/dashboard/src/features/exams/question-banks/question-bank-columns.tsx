"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { questionBankPath } from "@/config/paths";
import type { QuestionBankRecord } from "@/services";
import {
  BANKS_ACTIONS_COLUMN_ID,
  DEFAULT_BANK_STATUS,
} from "@/services/modules/question-banks/question-banks-constant";
import { BankStatusBadge } from "./bank-status-badge";

export interface QuestionBankRowActions {
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (record: QuestionBankRecord) => void;
  onRemove: (record: QuestionBankRecord) => void;
}

/**
 * The banks table's columns; `name` is the one sortable id (`BANKS_SORT_FIELD`). The name links
 * to the bank's page; a bank with no class reads "Every level". Memoized on its inputs, so the
 * caller passes `useCallback`-stable handlers.
 */
export function useQuestionBankColumns(
  actions: QuestionBankRowActions,
): ColumnDef<QuestionBankRecord>[] {
  const t = useTranslations("exams");
  const { canUpdate, canDelete, onEdit, onRemove } = actions;

  return useMemo<ColumnDef<QuestionBankRecord>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("questionBanks.columns.name")} />
        ),
        cell: ({ row }) => (
          <Link
            href={questionBankPath(row.original.id)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
        meta: {
          headerTitle: t("questionBanks.columns.name"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "subject",
        enableSorting: false,
        header: () => t("questionBanks.columns.subject"),
        cell: ({ row }) => row.original.subject_name,
        meta: {
          headerTitle: t("questionBanks.columns.subject"),
          skeleton: <Skeleton className="h-4 w-28" />,
        },
      },
      {
        id: "class",
        enableSorting: false,
        header: () => t("questionBanks.columns.class"),
        cell: ({ row }) => row.original.class_name ?? t("questionBanks.everyLevel"),
        meta: {
          headerTitle: t("questionBanks.columns.class"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "questions",
        enableSorting: false,
        header: () => t("questionBanks.columns.questions"),
        cell: ({ row }) => row.original.question_count.toLocaleString(),
        meta: {
          headerTitle: t("questionBanks.columns.questions"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("questionBanks.columns.status"),
        cell: ({ row }) => <BankStatusBadge status={row.original.status ?? DEFAULT_BANK_STATUS} />,
        meta: {
          headerTitle: t("questionBanks.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: BANKS_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <RowEditRemoveActions
              editLabel={
                canUpdate ? t("questionBanks.actions.editRow", { name: record.name }) : undefined
              }
              onEdit={() => {
                onEdit(record);
              }}
              removeLabel={
                canDelete ? t("questionBanks.actions.deleteRow", { name: record.name }) : undefined
              }
              onRemove={() => {
                onRemove(record);
              }}
            />
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-16" /> },
      },
    ],
    [t, canUpdate, canDelete, onEdit, onRemove],
  );
}
