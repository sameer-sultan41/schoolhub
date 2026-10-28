"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Skeleton } from "@schoolhub/ui";
import { Check, X } from "lucide-react";
import type { AuthenticatedUser } from "@schoolhub/types";

import { CorrectionDiff } from "@/features/attendance/corrections/correction-diff";
import { RequestStatusBadge } from "@/features/attendance/request-status-badge";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { AttendanceCorrectionRecord, CorrectionAction } from "@/services";
import { CORRECTIONS_ACTIONS_COLUMN_ID } from "@/services/modules/attendance-corrections/attendance-corrections-constant";
import { canDecideCorrection } from "@/services/modules/attendance-corrections/attendance-corrections-helper";

/**
 * The corrections queue's columns. Approve and Reject show on a pending request from someone
 * else, to a holder of `attendance.correction.approve` (`canApprove`); the API enforces the
 * same. `onDecide` must be `useCallback`-stable.
 */
export function useCorrectionColumns(
  user: AuthenticatedUser | undefined,
  canApprove: boolean,
  onDecide: (record: AttendanceCorrectionRecord, action: CorrectionAction) => void,
): ColumnDef<AttendanceCorrectionRecord>[] {
  const t = useTranslations("attendance");
  const locale = useLocale();

  return useMemo<ColumnDef<AttendanceCorrectionRecord>[]>(
    () => [
      {
        id: "student",
        enableSorting: false,
        header: () => t("corrections.columns.student"),
        cell: ({ row }) => row.original.student_name ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("corrections.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "date",
        enableSorting: false,
        header: () => t("corrections.columns.date"),
        cell: ({ row }) =>
          row.original.attendance_date
            ? formatDate(row.original.attendance_date, locale)
            : EMPTY_VALUE,
        meta: {
          headerTitle: t("corrections.columns.date"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        // Blank for a daily row.
        id: "period",
        enableSorting: false,
        header: () => t("corrections.columns.period"),
        cell: ({ row }) => row.original.period_name,
        meta: {
          headerTitle: t("corrections.columns.period"),
          skeleton: <Skeleton className="h-4 w-16" />,
        },
      },
      {
        id: "change",
        enableSorting: false,
        header: () => t("corrections.columns.change"),
        cell: ({ row }) => <CorrectionDiff correction={row.original} />,
        meta: {
          headerTitle: t("corrections.columns.change"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "reason",
        enableSorting: false,
        header: () => t("corrections.columns.reason"),
        cell: ({ row }) => (
          <span className="block max-w-64 whitespace-normal">{row.original.reason}</span>
        ),
        meta: {
          headerTitle: t("corrections.columns.reason"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "requestedBy",
        enableSorting: false,
        header: () => t("corrections.columns.requestedBy"),
        cell: ({ row }) => row.original.requested_by_name ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("corrections.columns.requestedBy"),
          skeleton: <Skeleton className="h-4 w-28" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("corrections.columns.status"),
        cell: ({ row }) => (
          <span className="block space-y-1">
            <RequestStatusBadge status={row.original.status} />
            {row.original.reviewed_by_name && (
              <span className="block text-xs text-muted-foreground">
                {t("corrections.reviewedBy", { name: row.original.reviewed_by_name })}
              </span>
            )}
            {row.original.review_note && (
              <span className="block max-w-64 text-xs whitespace-normal text-muted-foreground">
                {row.original.review_note}
              </span>
            )}
          </span>
        ),
        meta: {
          headerTitle: t("corrections.columns.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: CORRECTIONS_ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">{t("corrections.columns.actions")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          if (!canDecideCorrection(record, user, canApprove)) return null;
          const name = { name: record.student_name ?? EMPTY_VALUE };
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="primary"
                appearance="light"
                mode="icon"
                shape="circle"
                size="sm"
                aria-label={t("corrections.actions.approveRow", name)}
                onClick={() => {
                  onDecide(record, "approve");
                }}
              >
                <Check className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="destructive"
                appearance="light"
                mode="icon"
                shape="circle"
                size="sm"
                aria-label={t("corrections.actions.rejectRow", name)}
                onClick={() => {
                  onDecide(record, "reject");
                }}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, locale, user, canApprove, onDecide],
  );
}
