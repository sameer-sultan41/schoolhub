"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { ExpenseRecord } from "@/services";
import {
  canDecideExpense,
  canEditExpense,
  canMarkExpensePaid,
  canReverseExpense,
  canSubmitExpense,
} from "@/services/modules/expenses/expenses-helper";
import {
  EXPENSE_STATUS_BADGE,
  EXPENSE_STATUS_LABEL_KEY,
} from "@/features/fees/shared/expense-labels";
import { StatusBadge } from "@/features/fees/shared/status-badge";

export type ExpenseRowAction = "edit" | "submit" | "approve" | "reject" | "markPaid" | "reverse";

export interface ExpenseRowActions {
  /** `fees.expense.create`: Submit. */
  canCreate: boolean;
  /** `fees.expense.update`: Edit and Mark paid. */
  canUpdate: boolean;
  /** `fees.expense.approve`: Approve, Reject and Reverse. */
  canApprove: boolean;
  /** The viewer's user id, to hide Approve and Reject on an expense they created. */
  currentUserId: string | undefined;
  onAction: (action: ExpenseRowAction, expense: ExpenseRecord) => void;
}

/**
 * The expenses table's columns; `expense_date` and `amount` are the sortable ids. Each action
 * shows only where the key and the status allow it: Edit on a draft (`.update`), Submit on a
 * draft (`.create`), Approve and Reject on a submitted expense (`.approve`, never to its
 * creator), Mark paid on an approved one (`.update`), Reverse on an approved or paid one
 * (`.approve`). The server enforces every one of them again.
 */
export function useExpenseColumns({
  canCreate,
  canUpdate,
  canApprove,
  currentUserId,
  onAction,
}: ExpenseRowActions): ColumnDef<ExpenseRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<ExpenseRecord>[]>(() => {
    const button = (
      expense: ExpenseRecord,
      action: ExpenseRowAction,
      variant: "primary" | "destructive" | "secondary",
      appearance?: "light",
    ) => (
      <Button
        key={action}
        variant={variant}
        appearance={appearance}
        size="sm"
        aria-label={t(`expenses.expenses.actions.${action}Row`, { number: expense.expense_no })}
        onClick={() => {
          onAction(action, expense);
        }}
      >
        {t(`expenses.expenses.actions.${action}`)}
      </Button>
    );
    return [
      {
        id: "expense_no",
        enableSorting: false,
        header: () => t("expenses.expenses.columns.number"),
        cell: ({ row }) => <span className="font-mono">{row.original.expense_no}</span>,
        meta: {
          headerTitle: t("expenses.expenses.columns.number"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "expense_date",
        accessorKey: "expense_date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("expenses.expenses.columns.date")} />
        ),
        cell: ({ row }) => formatDate(row.original.expense_date, locale),
        meta: {
          headerTitle: t("expenses.expenses.columns.date"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "description",
        enableSorting: false,
        header: () => t("expenses.expenses.columns.description"),
        cell: ({ row }) => (
          <span className="flex max-w-xs flex-col whitespace-normal">
            <span className="line-clamp-2 font-medium text-foreground">
              {row.original.description}
            </span>
            {row.original.vendor_name && (
              <span className="text-xs text-muted-foreground">{row.original.vendor_name}</span>
            )}
          </span>
        ),
        meta: {
          headerTitle: t("expenses.expenses.columns.description"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "category",
        enableSorting: false,
        header: () => t("expenses.expenses.columns.category"),
        cell: ({ row }) => row.original.category_name || EMPTY_VALUE,
        meta: {
          headerTitle: t("expenses.expenses.columns.category"),
          skeleton: <Skeleton className="h-4 w-28" />,
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("expenses.expenses.columns.amount")} />
        ),
        // The total is `gross_amount`, a number on the wire: stringified, then formatted like every other money cell.
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatMoney(locale, String(row.original.gross_amount))}
          </span>
        ),
        meta: {
          headerTitle: t("expenses.expenses.columns.amount"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("expenses.expenses.columns.status"),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            labels={EXPENSE_STATUS_LABEL_KEY}
            variants={EXPENSE_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("expenses.expenses.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => {
          const expense = row.original;
          return (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {canUpdate &&
                canEditExpense(expense) &&
                button(expense, "edit", "secondary", "light")}
              {canCreate && canSubmitExpense(expense) && button(expense, "submit", "primary")}
              {canApprove && canDecideExpense(expense, currentUserId) && (
                <>
                  {button(expense, "approve", "primary", "light")}
                  {button(expense, "reject", "destructive", "light")}
                </>
              )}
              {canUpdate && canMarkExpensePaid(expense) && button(expense, "markPaid", "primary")}
              {canApprove &&
                canReverseExpense(expense) &&
                button(expense, "reverse", "destructive", "light")}
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="h-7 w-32" /> },
      },
    ];
  }, [t, locale, canCreate, canUpdate, canApprove, currentUserId, onAction]);
}
