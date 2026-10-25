"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Skeleton } from "@schoolhub/ui";
import { Check, X } from "lucide-react";
import type { AuthenticatedUser } from "@schoolhub/types";

import { useLeaveDates } from "@/features/attendance/leave/use-leave-dates";
import { RequestStatusBadge } from "@/features/attendance/request-status-badge";
import { EMPTY_VALUE } from "@/lib/constants";
import type { LeaveAction, LeaveRequestRecord } from "@/services";
import {
  LEAVE_ACTIONS_COLUMN_ID,
  LEAVE_DEFAULT_DAY_PART,
} from "@/services/modules/leave-requests/leave-requests-constant";
import {
  canDecideLeave,
  formatLeaveDays,
} from "@/services/modules/leave-requests/leave-requests-helper";

/**
 * The leave queue's columns. Approve and Reject show on a pending request that is not the
 * viewer's own and that they decided no level of, to a holder of
 * `attendance.leave-request.approve` (`canApprove`); the API enforces the same. `onDecide` must
 * be `useCallback`-stable.
 */
export function useLeaveColumns(
  user: AuthenticatedUser | undefined,
  canApprove: boolean,
  onDecide: (request: LeaveRequestRecord, action: LeaveAction) => void,
): ColumnDef<LeaveRequestRecord>[] {
  const t = useTranslations("attendance");
  const locale = useLocale();
  const leaveDates = useLeaveDates();

  return useMemo<ColumnDef<LeaveRequestRecord>[]>(
    () => [
      {
        id: "student",
        enableSorting: false,
        header: () => t("leave.columns.student"),
        cell: ({ row }) => (
          <span className="block">
            <span className="block">{row.original.student_name}</span>
            <span className="block text-xs text-muted-foreground">
              {row.original.admission_number}
            </span>
          </span>
        ),
        meta: {
          headerTitle: t("leave.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        // Blank for a student with no active enrollment in the current session.
        id: "section",
        enableSorting: false,
        header: () => t("leave.columns.section"),
        cell: ({ row }) => row.original.section_name ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("leave.columns.section"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "type",
        enableSorting: false,
        header: () => t("leave.columns.type"),
        cell: ({ row }) => row.original.leave_type_name,
        meta: {
          headerTitle: t("leave.columns.type"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "dates",
        enableSorting: false,
        header: () => t("leave.columns.dates"),
        cell: ({ row }) => leaveDates(row.original),
        meta: {
          headerTitle: t("leave.columns.dates"),
          skeleton: <Skeleton className="h-4 w-40" />,
        },
      },
      {
        id: "dayPart",
        enableSorting: false,
        header: () => t("leave.columns.dayPart"),
        cell: ({ row }) => t(`leave.dayPart.${row.original.day_part ?? LEAVE_DEFAULT_DAY_PART}`),
        meta: {
          headerTitle: t("leave.columns.dayPart"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        id: "days",
        enableSorting: false,
        header: () => t("leave.columns.days"),
        cell: ({ row }) => formatLeaveDays(row.original.days_count, locale),
        meta: {
          headerTitle: t("leave.columns.days"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("leave.columns.status"),
        cell: ({ row }) => <RequestStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("leave.columns.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        // Which step of the chain the request is at, out of the chain's length.
        id: "level",
        enableSorting: false,
        header: () => t("leave.columns.level"),
        cell: ({ row }) =>
          t("leave.levelOf", {
            level: row.original.current_approval_level,
            total: row.original.approvals.length,
          }),
        meta: {
          headerTitle: t("leave.columns.level"),
          skeleton: <Skeleton className="h-4 w-12" />,
        },
      },
      {
        id: LEAVE_ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">{t("leave.columns.actions")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const request = row.original;
          if (!canDecideLeave(request, user, canApprove)) return null;
          const name = { name: request.student_name };
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="primary"
                appearance="light"
                mode="icon"
                shape="circle"
                size="sm"
                aria-label={t("leave.actions.approveRow", name)}
                onClick={() => {
                  onDecide(request, "approve");
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
                aria-label={t("leave.actions.rejectRow", name)}
                onClick={() => {
                  onDecide(request, "reject");
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
    [t, locale, leaveDates, user, canApprove, onDecide],
  );
}
