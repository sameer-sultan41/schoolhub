"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";

import { EMPTY_VALUE } from "@/lib/constants";
import { formatMoney } from "@/lib/format-decimal";
import { formatDate } from "@/lib/helpers";
import type { RefundRecord } from "@/services";
import { canDecideRefund, canProcessRefund } from "@/services/modules/refunds/refunds-helper";
import { REFUND_STATUS_BADGE, REFUND_STATUS_LABEL_KEY } from "@/features/fees/shared/refund-labels";
import { StatusBadge } from "@/features/fees/shared/status-badge";

export interface RefundRowActions {
  /** Holds `fees.refund.approve`: Approve, Reject and Process all follow it. */
  canApprove: boolean;
  /** The viewer's user id, to hide Approve and Reject on a refund they requested. */
  currentUserId: string | undefined;
  onApprove: (refund: RefundRecord) => void;
  onReject: (refund: RefundRecord) => void;
  onProcess: (refund: RefundRecord) => void;
}

/**
 * The refunds table's columns; `created_at` and `amount` are the sortable ids. Approve and Reject
 * show on a requested refund to a holder of `fees.refund.approve`, never to the person who
 * requested it (the server refuses that, with a 422); Process shows on an approved refund.
 */
export function useRefundColumns({
  canApprove,
  currentUserId,
  onApprove,
  onReject,
  onProcess,
}: RefundRowActions): ColumnDef<RefundRecord>[] {
  const t = useTranslations("fees");
  const locale = useLocale();

  return useMemo<ColumnDef<RefundRecord>[]>(
    () => [
      {
        id: "student",
        enableSorting: false,
        header: () => t("payments.refunds.columns.student"),
        cell: ({ row }) => row.original.student_name,
        meta: {
          headerTitle: t("payments.refunds.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "invoice_no",
        enableSorting: false,
        header: () => t("payments.refunds.columns.invoice"),
        cell: ({ row }) => row.original.invoice_no,
        meta: {
          headerTitle: t("payments.refunds.columns.invoice"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("payments.refunds.columns.requested")} />
        ),
        cell: ({ row }) => formatDate(row.original.created_at, locale),
        meta: {
          headerTitle: t("payments.refunds.columns.requested"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("payments.refunds.columns.amount")} />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{formatMoney(locale, row.original.amount)}</span>
        ),
        meta: {
          headerTitle: t("payments.refunds.columns.amount"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "reason",
        enableSorting: false,
        header: () => t("payments.refunds.columns.reason"),
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-xs whitespace-normal">{row.original.reason}</span>
        ),
        meta: {
          headerTitle: t("payments.refunds.columns.reason"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("payments.refunds.columns.status"),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            labels={REFUND_STATUS_LABEL_KEY}
            variants={REFUND_STATUS_BADGE}
          />
        ),
        meta: {
          headerTitle: t("payments.refunds.columns.status"),
          skeleton: <Skeleton className="h-5 w-16 rounded-full" />,
        },
      },
      {
        id: "decision_note",
        enableSorting: false,
        header: () => t("payments.refunds.columns.note"),
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-xs whitespace-normal">
            {row.original.decision_note || EMPTY_VALUE}
          </span>
        ),
        meta: {
          headerTitle: t("payments.refunds.columns.note"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      ...(canApprove
        ? [
            {
              id: "actions",
              enableSorting: false,
              enableHiding: false,
              header: () => null,
              cell: ({ row }) => (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {canDecideRefund(row.original, currentUserId) && (
                    <>
                      <Button
                        variant="primary"
                        appearance="light"
                        size="sm"
                        aria-label={t("payments.refunds.actions.approveRow", {
                          amount: formatMoney(locale, row.original.amount),
                        })}
                        onClick={() => {
                          onApprove(row.original);
                        }}
                      >
                        {t("payments.refunds.actions.approve")}
                      </Button>
                      <Button
                        variant="destructive"
                        appearance="light"
                        size="sm"
                        aria-label={t("payments.refunds.actions.rejectRow", {
                          amount: formatMoney(locale, row.original.amount),
                        })}
                        onClick={() => {
                          onReject(row.original);
                        }}
                      >
                        {t("payments.refunds.actions.reject")}
                      </Button>
                    </>
                  )}
                  {canProcessRefund(row.original) && (
                    <Button
                      variant="primary"
                      size="sm"
                      aria-label={t("payments.refunds.actions.processRow", {
                        amount: formatMoney(locale, row.original.amount),
                      })}
                      onClick={() => {
                        onProcess(row.original);
                      }}
                    >
                      {t("payments.refunds.actions.process")}
                    </Button>
                  )}
                </div>
              ),
              meta: { skeleton: <Skeleton className="h-7 w-32" /> },
            } satisfies ColumnDef<RefundRecord>,
          ]
        : []),
    ],
    [t, locale, canApprove, currentUserId, onApprove, onReject, onProcess],
  );
}
