"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";
import { FilePenLine, Lock } from "lucide-react";

import { AttendanceStatusBadge } from "@/features/attendance/attendance-status";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import type { StudentAttendanceRecord } from "@/services";
import {
  RECORDS_ACTIONS_COLUMN_ID,
  RECORDS_DATE_COLUMN_ID,
} from "@/services/modules/student-attendance/student-attendance-constant";

/**
 * The Records list's columns; the sortable id is `RECORDS_SORT_FIELD`'s key. A locked row
 * offers Request correction when `canCorrect` (`attendance.correction.create`); the server
 * decides the rest. `onRequestCorrection` must be `useCallback`-stable.
 */
export function useRecordColumns(
  canCorrect: boolean,
  onRequestCorrection: (record: StudentAttendanceRecord) => void,
): ColumnDef<StudentAttendanceRecord>[] {
  const t = useTranslations("attendance");
  const locale = useLocale();

  return useMemo<ColumnDef<StudentAttendanceRecord>[]>(
    () => [
      {
        id: RECORDS_DATE_COLUMN_ID,
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
        id: "student",
        enableSorting: false,
        header: () => t("records.columns.student"),
        cell: ({ row }) => (
          <span className="block">
            <span className="block">{row.original.student_name}</span>
            <span className="block text-xs text-muted-foreground">
              {row.original.admission_number}
            </span>
          </span>
        ),
        meta: {
          headerTitle: t("records.columns.student"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "section",
        enableSorting: false,
        header: () => t("records.columns.section"),
        cell: ({ row }) => row.original.section_name,
        meta: {
          headerTitle: t("records.columns.section"),
          skeleton: <Skeleton className="h-4 w-20" />,
        },
      },
      {
        // Blank for a daily row; shown in both modes, as rows from before a switch remain.
        id: "period",
        enableSorting: false,
        header: () => t("records.columns.period"),
        cell: ({ row }) => row.original.period_name,
        meta: {
          headerTitle: t("records.columns.period"),
          skeleton: <Skeleton className="h-4 w-16" />,
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
        id: "source",
        enableSorting: false,
        header: () => t("records.columns.source"),
        cell: ({ row }) => t(`records.source.${row.original.source}`),
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
        id: RECORDS_ACTIONS_COLUMN_ID,
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
              aria-label={t("register.requestCorrectionFor", { name: row.original.student_name })}
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
