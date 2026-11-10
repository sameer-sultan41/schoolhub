"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { EMPTY_VALUE } from "@/lib/constants";
import type { ExpenseCategoryRecord } from "@/services";
import { LookedUpName } from "@/features/fees/shared/name-lookup";

export interface CategoryRowActions {
  /** Edit: needs `fees.expense.create` and the ledger read its account picker makes (L59). */
  canEdit: boolean;
  /** Delete: needs `fees.expense.create`. */
  canRemove: boolean;
  onEdit: (record: ExpenseCategoryRecord) => void;
  onRemove: (record: ExpenseCategoryRecord) => void;
}

/**
 * The categories table's columns; `code` and `name` are the sortable ids. The ledger account's
 * name comes through `LookedUpName`, so it arriving never rebuilds the columns.
 */
export function useCategoryColumns({
  canEdit,
  canRemove,
  onEdit,
  onRemove,
}: CategoryRowActions): ColumnDef<ExpenseCategoryRecord>[] {
  const t = useTranslations("fees");

  return useMemo<ColumnDef<ExpenseCategoryRecord>[]>(
    () => [
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("expenses.categories.columns.code")} />
        ),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.code}</span>,
        meta: {
          headerTitle: t("expenses.categories.columns.code"),
          skeleton: <Skeleton className="h-4 w-16" />,
        },
      },
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("expenses.categories.columns.name")} />
        ),
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
        meta: {
          headerTitle: t("expenses.categories.columns.name"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "account",
        enableSorting: false,
        header: () => t("expenses.categories.columns.account"),
        cell: ({ row }) => (
          <LookedUpName kind="accounts" id={row.original.ledger_account} fallback={EMPTY_VALUE} />
        ),
        meta: {
          headerTitle: t("expenses.categories.columns.account"),
          skeleton: <Skeleton className="h-4 w-36" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("expenses.categories.columns.status"),
        cell: ({ row }) => (
          <Badge
            variant={row.original.is_active === false ? "secondary" : "success"}
            appearance="light"
          >
            {t(
              row.original.is_active === false
                ? "expenses.categories.status.inactive"
                : "expenses.categories.status.active",
            )}
          </Badge>
        ),
        meta: {
          headerTitle: t("expenses.categories.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <RowEditRemoveActions
              editLabel={
                canEdit
                  ? t("expenses.categories.actions.editRow", { name: record.name })
                  : undefined
              }
              onEdit={() => {
                onEdit(record);
              }}
              removeLabel={
                canRemove
                  ? t("expenses.categories.actions.deleteRow", { name: record.name })
                  : undefined
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
    [t, canEdit, canRemove, onEdit, onRemove],
  );
}
