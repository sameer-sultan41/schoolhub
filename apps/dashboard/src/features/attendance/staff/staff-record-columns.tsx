"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";
import { FilePenLine, Lock } from "lucide-react";

import { AttendanceStatusBadge } from "@/features/attendance/attendance-status";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { StaffAttendanceRecord } from "@/services";
import { toShortTime } from "@/services/modules/periods/periods-helper";
import {
  STAFF_HISTORY_ACTIONS_COLUMN_ID,
  STAFF_HISTORY_DATE_COLUMN_ID,
} from "@/services/modules/staff-attendance/staff-attendance-constant";

const timeOrBlank = (time: string | null | undefined) => (time ? toShortTime(time) : EMPTY_VALUE);

/**
 * The staff history's columns; the sortable id is `STAFF_HISTORY_SORT_FIELD`'s key. A locked row
 * offers Request correction when `canCorrect` (`attendance.correction.create`); the server
 * decides the rest. `onRequestCorrection` must be `useCallback`-stable.
 */
export function useStaffRecordColumns(
  canCorrect: boolean,
  onRequestCorrection: (record: StaffAttendanceRecord) => void,
): ColumnDef<StaffAttendanceRecord>[] {
  const t = useTranslations("attendance");
  const locale = useLocale();

  return useMemo<ColumnDef<StaffAttendanceRecord>[]>(
    () => [
      {
        id: STAFF_HISTORY_DATE_COLUMN_ID,
        accessorKey: "attendance_date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("records.columns.date")} />
        ),
        cell: ({ row }) => formatDate(row.original.attendance_date, locale),
        meta: {
          headerTitle: t("records.columns.date"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        // Whose row: the viewer's own, or anyone's their role covers.
        id: "staff",
        enableSorting: false,
        header: () => t("staff.history.columns.staff"),
        cell: ({ row }) => (
          <span className="block">
            <span className="block">{row.original.staff_name}</span>
            <span className="block text-xs text-muted-foreground">
              {row.original.employee_number}
            </span>
          </span>
        ),
        meta: {
          headerTitle: t("staff.history.columns.staff"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "status",
        enableSorting: false,
        header: () => t("records.columns.status"),
        cell: ({ row }) => <AttendanceStatusBadge status={row.original.status} />,
        meta: {
          headerTitle: t("records.columns.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: "checkIn",
        enableSorting: false,
        header: () => t("staff.history.columns.checkIn"),
        cell: ({ row }) => timeOrBlank(row.original.check_in_time),
        meta: {
          headerTitle: t("staff.history.columns.checkIn"),
          skeleton: <Skeleton className="h-4 w-12" />,
        },
      },
      {
        id: "checkOut",
        enableSorting: false,
        header: () => t("staff.history.columns.checkOut"),
        cell: ({ row }) => timeOrBlank(row.original.check_out_time),
        meta: {
          headerTitle: t("staff.history.columns.checkOut"),
          skeleton: <Skeleton className="h-4 w-12" />,
        },
      },
      {
        id: "lateMinutes",
        enableSorting: false,
        header: () => t("records.columns.lateMinutes"),
        cell: ({ row }) => row.original.late_minutes ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("records.columns.lateMinutes"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "earlyMinutes",
        enableSorting: false,
        header: () => t("staff.history.columns.earlyMinutes"),
        cell: ({ row }) => row.original.early_departure_minutes ?? EMPTY_VALUE,
        meta: {
          headerTitle: t("staff.history.columns.earlyMinutes"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "source",
        enableSorting: false,
        header: () => t("records.columns.source"),
        // A staff row has no `system` source; `self` is a staff member's own check-in.
        cell: ({ row }) => t(`records.source.${row.original.source ?? "manual"}`),
        meta: {
          headerTitle: t("records.columns.source"),
          skeleton: <Skeleton className="h-4 w-16" />,
        },
      },
      {
        id: "locked",
        enableSorting: false,
        header: () => <span className="sr-only">{t("records.columns.locked")}</span>,
        cell: ({ row }) =>
          row.original.is_locked && (
            <>
              <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{t("register.locked")}</span>
            </>
          ),
        meta: {
          headerTitle: t("records.columns.locked"),
          skeleton: <Skeleton className="size-4" />,
        },
      },
      {
        id: STAFF_HISTORY_ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">{t("records.columns.actions")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          canCorrect &&
          row.original.is_locked && (
            <Button
              variant="secondary"
              appearance="light"
              mode="icon"
              shape="circle"
              size="sm"
              aria-label={t("register.requestCorrectionFor", { name: row.original.staff_name })}
              onClick={() => {
                onRequestCorrection(row.original);
              }}
            >
              <FilePenLine className="size-4" aria-hidden="true" />
            </Button>
          ),
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, locale, canCorrect, onRequestCorrection],
  );
}
