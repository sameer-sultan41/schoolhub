"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import { Services, type ReceiptRecord } from "@/services";
import { DocumentDownloadButtons } from "@/features/fees/shared/document-download-buttons";

/** The receipts table's columns; `issued_at` and `amount` are the sortable ids. Download streams the receipt in either layout. */
export function useReceiptColumns(): ColumnDef<ReceiptRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<ReceiptRecord>[]>(
    () => [
      {
        id: "receipt_no",
        enableSorting: false,
        header: () => t("payments.receipts.columns.receipt"),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.receipt_no}</span>
        ),
        meta: {
          headerTitle: t("payments.receipts.columns.receipt"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "student",
        enableSorting: false,
        header: () => t("payments.receipts.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("payments.receipts.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "invoice",
        enableSorting: false,
        header: () => t("payments.receipts.columns.invoice"),
        cell: ({ row }) => row.original.invoice_no,
        meta: {
          headerTitle: t("payments.receipts.columns.invoice"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "issued_at",
        accessorKey: "issued_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("payments.receipts.columns.issued")} />
        ),
        cell: ({ row }) => formatDate(row.original.issued_at, locale),
        meta: {
          headerTitle: t("payments.receipts.columns.issued"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("payments.receipts.columns.amount")} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(locale, row.original.amount)}</span>
        ),
        meta: {
          headerTitle: t("payments.receipts.columns.amount"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "download",
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => (
          <DocumentDownloadButtons
            label={row.original.receipt_no}
            download={(layout) => Services.receipts.downloadReceipt(row.original.id, layout)}
          />
        ),
        meta: { skeleton: <Skeleton className="h-7 w-32" /> },
      },
    ],
    [t, locale],
  );
}
