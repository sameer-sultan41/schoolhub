"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Skeleton } from "@schoolhub/ui";
import type { AuthenticatedUser } from "@schoolhub/types";

import { CorrectionDiff } from "@/features/attendance/corrections/correction-diff";
import { decisionActionsColumn } from "@/features/attendance/decision-actions-column";
import { RequestStatusBadge } from "@/features/attendance/request-status-badge";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { AttendanceCorrectionRecord, CorrectionAction } from "@/services";
import { CORRECTIONS_ACTIONS_COLUMN_ID } from "@/services/modules/attendance-corrections/attendance-corrections-constant";
import {
  canDecideCorrection,
  correctionSubjectName,
} from "@/services/modules/attendance-corrections/attendance-corrections-helper";

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
        // A staff correction names the staff member, with their employee number.
        cell: ({ row }) => (
          <span className="block">
            <span className="block">{correctionSubjectName(row.original) ?? EMPTY_VALUE}</span>
            {row.original.subject_type === "staff" && (
              <span className="block text-xs text-muted-foreground">
                {t("corrections.subject.staff")}
                {row.original.employee_number && ` · ${row.original.employee_number}`}
              </span>
            )}
          </span>
        ),
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
        // Blank for a student's daily row; a staff row is always a whole day, and says so.
        id: "period",
        enableSorting: false,
        header: () => t("corrections.columns.period"),
        cell: ({ row }) =>
          row.original.subject_type === "staff" ? (
            <span className="text-muted-foreground">{t("corrections.staffDay")}</span>
          ) : (
            row.original.period_name
          ),
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
      decisionActionsColumn<AttendanceCorrectionRecord>({
        id: CORRECTIONS_ACTIONS_COLUMN_ID,
        header: t("corrections.columns.actions"),
        canDecide: (record) => canDecideCorrection(record, user, canApprove),
        labels: (record) => {
          const name = { name: correctionSubjectName(record) ?? EMPTY_VALUE };
          return {
            approve: t("corrections.actions.approveRow", name),
            reject: t("corrections.actions.rejectRow", name),
          };
        },
        onDecide,
      }),
    ],
    [t, locale, user, canApprove, onDecide],
  );
}
