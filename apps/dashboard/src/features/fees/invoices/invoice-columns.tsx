"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { feeInvoicePath } from "@/config/paths";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { FeeInvoiceRecord } from "@/services";
import { InvoiceStatusBadge } from "@/features/fees/shared/invoice-status-badge";
import { LookedUpName } from "@/features/fees/shared/name-lookup";

/**
 * The invoices table's columns; `issue_date`, `due_date` and `balance_due` are the sortable ids.
 * The invoice number links to the invoice's page. Names arrive through `LookedUpName`, never a
 * dependency of this memo (the structure's name landing must not rebuild the columns). Amounts
 * are the server's own strings, formatted for display only.
 */
export function useInvoiceColumns(): ColumnDef<FeeInvoiceRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<FeeInvoiceRecord>[]>(
    () => [
      {
        id: "invoice_no",
        enableSorting: false,
        header: () => t("invoices.columns.number"),
        cell: ({ row }) => (
          <Link
            href={feeInvoicePath(row.original.id)}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {row.original.invoice_no}
          </Link>
        ),
        meta: {
          headerTitle: t("invoices.columns.number"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "student",
        enableSorting: false,
        header: () => t("invoices.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("invoices.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "structure",
        enableSorting: false,
        header: () => t("invoices.columns.structure"),
        cell: ({ row }) =>
          row.original.fee_structure ? (
            <LookedUpName
              kind="structures"
              id={row.original.fee_structure}
              fallback={EMPTY_VALUE}
            />
          ) : (
            t("invoices.adHoc")
          ),
        meta: {
          headerTitle: t("invoices.columns.structure"),
          skeleton: <Skeleton className="h-4 w-28" />,
        },
      },
      {
        id: "period",
        enableSorting: false,
        header: () => t("invoices.columns.period"),
        cell: ({ row }) => row.original.period_label || EMPTY_VALUE,
        meta: {
          headerTitle: t("invoices.columns.period"),
          skeleton: <Skeleton className="h-4 w-16" />,
        },
      },
      {
        id: "issue_date",
        accessorKey: "issue_date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("invoices.columns.issued")} />
        ),
        cell: ({ row }) => formatDate(row.original.issue_date, locale),
        meta: {
          headerTitle: t("invoices.columns.issued"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "due_date",
        accessorKey: "due_date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("invoices.columns.due")} />
        ),
        cell: ({ row }) => formatDate(row.original.due_date, locale),
        meta: {
          headerTitle: t("invoices.columns.due"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "balance_due",
        accessorKey: "balance_due",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("invoices.columns.balance")} />
        ),
        cell: ({ row }) => (
          <span className="block text-end tabular-nums">
            {formatMoney(locale, row.original.balance_due)}
          </span>
        ),
        meta: {
          headerTitle: t("invoices.columns.balance"),
          skeleton: <Skeleton className="ms-auto h-4 w-16" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("invoices.columns.status"),
        cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("invoices.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
    ],
    [t, locale],
  );
}
