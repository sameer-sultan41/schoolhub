"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import type { FeeHeadRecord } from "@/services";
import { FEE_HEADS_ACTIONS_COLUMN_ID } from "@/services/modules/fee-heads/fee-heads-constant";
import { FEE_HEAD_CATEGORY_LABEL_KEY } from "../shared/fee-setup-labels";

export interface FeeHeadRowActions {
  canUpdate: boolean;
  canDelete: boolean;
  /** A ledger account's display name by id; empty when the viewer cannot read the ledger. */
  accountNames: ReadonlyMap<string, string>;
  onEdit: (record: FeeHeadRecord) => void;
  onRemove: (record: FeeHeadRecord) => void;
}

/**
 * The fee heads table's columns; `code` and `name` are the sortable ids. Memoized on its inputs,
 * so the caller passes `useCallback`-stable handlers.
 */
export function useFeeHeadColumns(actions: FeeHeadRowActions): ColumnDef<FeeHeadRecord>[] {
  const t = useTranslations("fees");
  const { canUpdate, canDelete, accountNames, onEdit, onRemove } = actions;

  return useMemo<ColumnDef<FeeHeadRecord>[]>(
    () => [
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("heads.columns.code")} />
        ),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.code}</span>,
        meta: { headerTitle: t("heads.columns.code"), skeleton: <Skeleton className="h-4 w-20" /> },
      },
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("heads.columns.name")} />
        ),
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
        meta: { headerTitle: t("heads.columns.name"), skeleton: <Skeleton className="h-4 w-40" /> },
      },
      {
        id: "category",
        enableSorting: false,
        header: () => t("heads.columns.category"),
        cell: ({ row }) =>
          row.original.category
            ? enumLabel(t, FEE_HEAD_CATEGORY_LABEL_KEY, row.original.category)
            : EMPTY_VALUE,
        meta: {
          headerTitle: t("heads.columns.category"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "account",
        enableSorting: false,
        header: () => t("heads.columns.account"),
        cell: ({ row }) => accountNames.get(row.original.ledger_account) ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("heads.columns.account"),
          skeleton: <Skeleton className="h-4 w-36" />,
        },
      },
      {
        id: "refundable",
        enableSorting: false,
        header: () => t("heads.columns.refundable"),
        cell: ({ row }) =>
          t(row.original.is_refundable ? "heads.refundable.yes" : "heads.refundable.no"),
        meta: {
          headerTitle: t("heads.columns.refundable"),
          skeleton: <Skeleton className="h-4 w-10" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("heads.columns.status"),
        cell: ({ row }) => (
          <Badge
            variant={row.original.is_active === false ? "secondary" : "success"}
            appearance="light"
          >
            {t(row.original.is_active === false ? "heads.status.inactive" : "heads.status.active")}
          </Badge>
        ),
        meta: {
          headerTitle: t("heads.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: FEE_HEADS_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <RowEditRemoveActions
              editLabel={canUpdate ? t("heads.actions.editRow", { name: record.name }) : undefined}
              onEdit={() => {
                onEdit(record);
              }}
              removeLabel={
                canDelete ? t("heads.actions.deleteRow", { name: record.name }) : undefined
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
    [t, canUpdate, canDelete, accountNames, onEdit, onRemove],
  );
}
