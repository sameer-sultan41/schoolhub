"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { BudgetRecord } from "@/services";
import {
  budgetTargetsAccount,
  canApproveBudget,
  canEditBudget,
} from "@/services/modules/budgets/budgets-helper";
import {
  BUDGET_STATUS_BADGE,
  BUDGET_STATUS_LABEL_KEY,
} from "@/features/fees/shared/expense-labels";
import { LookedUpName } from "@/features/fees/shared/name-lookup";
import { StatusBadge } from "@/features/fees/shared/status-badge";

export interface BudgetRowActions {
  /** `fees.budget.create`: Edit. */
  canEdit: boolean;
  /** `fees.ledger.view`: an account-targeted budget's form picks from the ledger (L59). */
  canReadLedger: boolean;
  /** `fees.budget.approve`: Approve. */
  canApprove: boolean;
  onEdit: (budget: BudgetRecord) => void;
  onApprove: (budget: BudgetRecord) => void;
}

/**
 * The budgets table's columns; `period_start` and `amount` are the sortable ids. Edit and Approve
 * show only on a draft: an approved budget is the variance report's baseline, so the UI does not
 * reopen it. Approve is the owner's key alone.
 */
export function useBudgetColumns({
  canEdit,
  canReadLedger,
  canApprove,
  onEdit,
  onApprove,
}: BudgetRowActions): ColumnDef<BudgetRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<BudgetRecord>[]>(
    () => [
      {
        id: "name",
        enableSorting: false,
        header: () => t("expenses.budgets.columns.name"),
        cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
        meta: {
          headerTitle: t("expenses.budgets.columns.name"),
          skeleton: <Skeleton className="h-4 w-36" />,
        },
      },
      {
        id: "target",
        enableSorting: false,
        header: () => t("expenses.budgets.columns.target"),
        cell: ({ row }) => {
          const budget = row.original;
          const id = budget.expense_category ?? budget.ledger_account;
          return id ? (
            <LookedUpName
              kind={budgetTargetsAccount(budget) ? "accounts" : "categories"}
              id={id}
              fallback={EMPTY_VALUE}
            />
          ) : (
            EMPTY_VALUE
          );
        },
        meta: {
          headerTitle: t("expenses.budgets.columns.target"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "period_start",
        accessorKey: "period_start",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("expenses.budgets.columns.period")} />
        ),
        cell: ({ row }) =>
          t("expenses.budgets.period", {
            start: formatDate(row.original.period_start, locale),
            end: formatDate(row.original.period_end, locale),
          }),
        meta: {
          headerTitle: t("expenses.budgets.columns.period"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("expenses.budgets.columns.amount")} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(locale, row.original.amount)}</span>
        ),
        meta: {
          headerTitle: t("expenses.budgets.columns.amount"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("expenses.budgets.columns.status"),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            labels={BUDGET_STATUS_LABEL_KEY}
            variants={BUDGET_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("expenses.budgets.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => {
          const budget = row.original;
          const editable =
            canEdit && canEditBudget(budget) && (!budgetTargetsAccount(budget) || canReadLedger);
          return (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {editable && (
                <Button
                  variant="secondary"
                  appearance="light"
                  size="sm"
                  aria-label={t("expenses.budgets.actions.editRow", { name: budget.name })}
                  onClick={() => {
                    onEdit(budget);
                  }}
                >
                  {t("expenses.budgets.actions.edit")}
                </Button>
              )}
              {canApprove && canApproveBudget(budget) && (
                <Button
                  variant="primary"
                  size="sm"
                  aria-label={t("expenses.budgets.actions.approveRow", { name: budget.name })}
                  onClick={() => {
                    onApprove(budget);
                  }}
                >
                  {t("expenses.budgets.actions.approve")}
                </Button>
              )}
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-28" /> },
      },
    ],
    [t, locale, canEdit, canReadLedger, canApprove, onEdit, onApprove],
  );
}
