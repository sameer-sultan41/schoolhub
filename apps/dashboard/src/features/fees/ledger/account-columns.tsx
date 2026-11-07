"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { enumLabel } from "@/lib/enum-label";
import type { LedgerAccountRecord } from "@/services";
import { LEDGER_ACCOUNTS_ACTIONS_COLUMN_ID } from "@/services/modules/ledger-accounts/ledger-accounts-constant";
import { LookedUpName } from "@/features/fees/shared/name-lookup";
import { LEDGER_ACCOUNT_TYPE_LABEL_KEY } from "@/features/fees/shared/fee-setup-labels";

export interface AccountRowActions {
  canWrite: boolean;
  onEdit: (record: LedgerAccountRecord) => void;
  onRemove: (record: LedgerAccountRecord) => void;
}

/**
 * The accounts table's columns; `code` and `name` are the sortable ids. Edit shows to a holder
 * of `fees.ledger.create`; Delete also needs a non-system account, which the server would
 * refuse. Memoized on its inputs, so the caller passes `useCallback`-stable handlers; the parent
 * names come through `LookedUpName`, not an input, so they never rebuild the columns.
 */
export function useAccountColumns(actions: AccountRowActions): ColumnDef<LedgerAccountRecord>[] {
  const t = useTranslations("fees");
  const { canWrite, onEdit, onRemove } = actions;

  return useMemo<ColumnDef<LedgerAccountRecord>[]>(
    () => [
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("ledger.accounts.columns.code")} />
        ),
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.code}</span>,
        meta: {
          headerTitle: t("ledger.accounts.columns.code"),
          skeleton: <Skeleton className="h-4 w-16" />,
        },
      },
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("ledger.accounts.columns.name")} />
        ),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{row.original.name}</span>
            {row.original.is_system && (
              <Badge size="sm" variant="secondary" appearance="light">
                {t("ledger.accounts.system")}
              </Badge>
            )}
          </span>
        ),
        meta: {
          headerTitle: t("ledger.accounts.columns.name"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "type",
        enableSorting: false,
        header: () => t("ledger.accounts.columns.type"),
        cell: ({ row }) => enumLabel(t, LEDGER_ACCOUNT_TYPE_LABEL_KEY, row.original.account_type),
        meta: {
          headerTitle: t("ledger.accounts.columns.type"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "parent",
        enableSorting: false,
        header: () => t("ledger.accounts.columns.parent"),
        cell: ({ row }) =>
          row.original.parent ? (
            <LookedUpName
              kind="accounts"
              id={row.original.parent}
              fallback={t("ledger.accounts.noParent")}
            />
          ) : (
            t("ledger.accounts.noParent")
          ),
        meta: {
          headerTitle: t("ledger.accounts.columns.parent"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("ledger.accounts.columns.status"),
        cell: ({ row }) => (
          <Badge
            variant={row.original.is_active === false ? "secondary" : "success"}
            appearance="light"
          >
            {t(
              row.original.is_active === false
                ? "ledger.accounts.status.inactive"
                : "ledger.accounts.status.active",
            )}
          </Badge>
        ),
        meta: {
          headerTitle: t("ledger.accounts.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: LEDGER_ACCOUNTS_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          return (
            <RowEditRemoveActions
              editLabel={
                canWrite ? t("ledger.accounts.actions.editRow", { name: record.name }) : undefined
              }
              onEdit={() => {
                onEdit(record);
              }}
              removeLabel={
                canWrite && !record.is_system
                  ? t("ledger.accounts.actions.deleteRow", { name: record.name })
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
    [t, canWrite, onEdit, onRemove],
  );
}
