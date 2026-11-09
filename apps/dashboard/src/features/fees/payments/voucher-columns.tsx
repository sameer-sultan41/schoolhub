"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { enumLabel } from "@/lib/enum-label";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import { Services, type VoucherRecord } from "@/services";
import { canVoidVoucher } from "@/services/modules/vouchers/vouchers-helper";
import { DocumentDownloadButtons } from "@/features/fees/shared/document-download-buttons";
import { StatusBadge } from "@/features/fees/shared/status-badge";
import {
  VOUCHER_PROVIDER_LABEL_KEY,
  VOUCHER_STATUS_BADGE,
  VOUCHER_STATUS_LABEL_KEY,
} from "@/features/fees/shared/voucher-labels";

export interface VoucherRowActions {
  canVoid: boolean;
  onVoid: (voucher: VoucherRecord) => void;
}

/**
 * The vouchers table's columns; `due_date` is the sortable id. Download is always offered (the
 * list's own key). Void shows only to a holder of `fees.payment.collect`, and only on an issued
 * slip: a paid one is refused by the server and the button is not offered.
 */
export function useVoucherColumns({
  canVoid,
  onVoid,
}: VoucherRowActions): ColumnDef<VoucherRecord>[] {
  const t = useTranslations("fees");
  const providerT = useTranslations("portal.fees");
  const locale = useLocale();

  return useMemo<ColumnDef<VoucherRecord>[]>(
    () => [
      {
        id: "consumer_number",
        enableSorting: false,
        header: () => t("payments.vouchers.columns.consumer"),
        cell: ({ row }) => (
          <span className="font-medium text-foreground tabular-nums">
            {row.original.consumer_number}
          </span>
        ),
        meta: {
          headerTitle: t("payments.vouchers.columns.consumer"),
          skeleton: <Skeleton className="h-4 w-28" />,
        },
      },
      {
        id: "student",
        enableSorting: false,
        header: () => t("payments.vouchers.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("payments.vouchers.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "invoice",
        enableSorting: false,
        header: () => t("payments.vouchers.columns.invoice"),
        cell: ({ row }) => row.original.invoice_no,
        meta: {
          headerTitle: t("payments.vouchers.columns.invoice"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "provider",
        enableSorting: false,
        header: () => t("payments.vouchers.columns.provider"),
        cell: ({ row }) => enumLabel(providerT, VOUCHER_PROVIDER_LABEL_KEY, row.original.provider),
        meta: {
          headerTitle: t("payments.vouchers.columns.provider"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "due_date",
        accessorKey: "due_date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("payments.vouchers.columns.due")} />
        ),
        cell: ({ row }) => formatDate(row.original.due_date, locale),
        meta: {
          headerTitle: t("payments.vouchers.columns.due"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("payments.vouchers.columns.status"),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            labels={VOUCHER_STATUS_LABEL_KEY}
            variants={VOUCHER_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("payments.vouchers.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "amount",
        enableSorting: false,
        header: () => t("payments.vouchers.columns.amount"),
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(locale, row.original.amount)}</span>
        ),
        meta: {
          headerTitle: t("payments.vouchers.columns.amount"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "actions",
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <DocumentDownloadButtons
              label={row.original.consumer_number}
              download={(layout) => Services.vouchers.downloadVoucher(row.original.id, layout)}
            />
            {canVoid && canVoidVoucher(row.original) && (
              <Button
                variant="destructive"
                appearance="light"
                size="sm"
                aria-label={t("payments.vouchers.actions.voidRow", {
                  number: row.original.consumer_number,
                })}
                onClick={() => {
                  onVoid(row.original);
                }}
              >
                {t("payments.vouchers.actions.void")}
              </Button>
            )}
          </div>
        ),
        meta: { skeleton: <Skeleton className="h-7 w-40" /> },
      },
    ],
    [t, providerT, locale, canVoid, onVoid],
  );
}
