"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { feeInvoicePath } from "@/config/paths";
import { EMPTY_VALUE } from "@/lib/constants";
import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { PaymentRecord } from "@/services";
import {
  PAYMENT_METHOD_LABEL_KEY,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABEL_KEY,
} from "@/features/fees/shared/payment-labels";
import { StatusBadge } from "@/features/fees/shared/status-badge";

/**
 * The payments table's columns; `paid_at` and `amount` are the sortable ids. A row names its
 * student and invoice and links to the invoice, which shows only to a holder of the invoice
 * read (`canOpenInvoice`, L55).
 */
export function usePaymentColumns({
  canOpenInvoice,
}: {
  canOpenInvoice: boolean;
}): ColumnDef<PaymentRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<PaymentRecord>[]>(
    () => [
      {
        id: "receipt",
        enableSorting: false,
        header: () => t("payments.payments.columns.receipt"),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.receipt_no || EMPTY_VALUE}
          </span>
        ),
        meta: {
          headerTitle: t("payments.payments.columns.receipt"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "student",
        enableSorting: false,
        header: () => t("payments.payments.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("payments.payments.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "invoice_no",
        enableSorting: false,
        header: () => t("payments.payments.columns.invoice"),
        cell: ({ row }) => row.original.invoice_no,
        meta: {
          headerTitle: t("payments.payments.columns.invoice"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "paid_at",
        accessorKey: "paid_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("payments.payments.columns.paidAt")} />
        ),
        cell: ({ row }) =>
          row.original.paid_at ? formatDate(row.original.paid_at, locale) : EMPTY_VALUE,
        meta: {
          headerTitle: t("payments.payments.columns.paidAt"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "method",
        enableSorting: false,
        header: () => t("payments.payments.columns.method"),
        cell: ({ row }) => enumLabel(t, PAYMENT_METHOD_LABEL_KEY, row.original.method),
        meta: {
          headerTitle: t("payments.payments.columns.method"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "reference",
        enableSorting: false,
        header: () => t("payments.payments.columns.reference"),
        cell: ({ row }) => row.original.reference_no || EMPTY_VALUE,
        meta: {
          headerTitle: t("payments.payments.columns.reference"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("payments.payments.columns.status"),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            labels={PAYMENT_STATUS_LABEL_KEY}
            variants={PAYMENT_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("payments.payments.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("payments.payments.columns.amount")} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(locale, row.original.amount)}</span>
        ),
        meta: {
          headerTitle: t("payments.payments.columns.amount"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      ...(canOpenInvoice
        ? [
            {
              id: "invoice",
              enableSorting: false,
              enableHiding: false,
              header: () => null,
              cell: ({ row }) => (
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={feeInvoicePath(row.original.fee_invoice)}
                    aria-label={t("payments.payments.openInvoiceRow", {
                      number: row.original.receipt_no || EMPTY_VALUE,
                    })}
                  >
                    {t("payments.payments.openInvoice")}
                  </Link>
                </Button>
              ),
              meta: { skeleton: <Skeleton className="h-7 w-20" /> },
            } satisfies ColumnDef<PaymentRecord>,
          ]
        : []),
    ],
    [t, locale, canOpenInvoice],
  );
}
