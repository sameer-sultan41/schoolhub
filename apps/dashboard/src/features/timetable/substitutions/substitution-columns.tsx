"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, BadgeDot, Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";
import { Ban, Check, X } from "lucide-react";
import type { AuthenticatedUser } from "@schoolhub/types";

import { formatDate } from "@/lib/helpers";
import { hasPermission } from "@/lib/permissions";
import type { SubstitutionAction, SubstitutionStatus, TeacherSubstitutionRecord } from "@/services";
import { SUBSTITUTIONS_ACTIONS_COLUMN_ID } from "@/services/modules/teacher-substitutions/teacher-substitutions-constant";
import { canCancelSubstitution } from "@/services/modules/teacher-substitutions/teacher-substitutions-helper";
import { useCellLabel } from "@/features/timetable/use-cell-label";

/** Status as a dot, a word and a tone; never colour alone. */
const STATUS_VARIANT: Record<SubstitutionStatus, "warning" | "success" | "secondary" | "primary"> =
  {
    proposed: "warning",
    confirmed: "success",
    declined: "secondary",
    completed: "primary",
    cancelled: "secondary",
  };

/**
 * The cover queue's columns; sortable ids are `SUBSTITUTIONS_SORT_FIELD`'s keys. Row actions
 * are gated on the key, the row's status and (for a proposer's withdrawal) who proposed it,
 * mirroring what the API itself allows. `onAction` must be `useCallback`-stable.
 */
export function useSubstitutionColumns(
  user: AuthenticatedUser | undefined,
  today: string,
  onAction: (record: TeacherSubstitutionRecord, action: SubstitutionAction) => void,
): ColumnDef<TeacherSubstitutionRecord>[] {
  const t = useTranslations("timetable");
  const locale = useLocale();
  const cellLabel = useCellLabel();
  const canDecide = hasPermission(user, "timetable.substitution.approve");

  return useMemo<ColumnDef<TeacherSubstitutionRecord>[]>(
    () => [
      {
        id: "date",
        accessorKey: "date",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("substitutions.columns.date")} />
        ),
        cell: ({ row }) => formatDate(row.original.date, locale),
        meta: {
          headerTitle: t("substitutions.columns.date"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: "period",
        enableSorting: false,
        header: () => t("substitutions.columns.period"),
        cell: ({ row }) => (
          <span className="block">
            <span className="block">
              {cellLabel(row.original.day_of_week, row.original.period_name)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {[row.original.section_name, row.original.subject_name].filter(Boolean).join(" · ")}
            </span>
          </span>
        ),
        meta: {
          headerTitle: t("substitutions.columns.period"),
          skeleton: <Skeleton className="h-4 w-32" />,
        },
      },
      {
        id: "absent",
        accessorKey: "absent_staff_name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.absentTeacher")} />
        ),
        meta: {
          headerTitle: t("fields.absentTeacher"),
          skeleton: <Skeleton className="h-4 w-28" />,
        },
      },
      {
        id: "substitute",
        accessorKey: "substitute_staff_name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("substitutions.columns.cover")} />
        ),
        cell: ({ row }) => (
          <span className="block">
            <span className="block">{row.original.substitute_staff_name}</span>
            {row.original.room_name && (
              <span className="block text-xs text-muted-foreground">{row.original.room_name}</span>
            )}
          </span>
        ),
        meta: {
          headerTitle: t("substitutions.columns.cover"),
          skeleton: <Skeleton className="h-4 w-28" />,
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataGridColumnHeader column={column} title={t("fields.status")} />,
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]} appearance="light">
            <BadgeDot />
            {t(`substitutions.status.${row.original.status}`)}
          </Badge>
        ),
        meta: {
          headerTitle: t("fields.status"),
          skeleton: <Skeleton className="h-5 w-20 rounded-full" />,
        },
      },
      {
        id: SUBSTITUTIONS_ACTIONS_COLUMN_ID,
        header: () => <span className="sr-only">{t("substitutions.columns.actions")}</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const record = row.original;
          const names = { absent: record.absent_staff_name, date: formatDate(record.date, locale) };
          const decidable = canDecide && record.status === "proposed";
          const cancellable = canCancelSubstitution(record, user, today);
          return (
            <div className="flex items-center gap-1">
              {decidable && (
                <>
                  <Button
                    variant="primary"
                    appearance="light"
                    mode="icon"
                    shape="circle"
                    size="sm"
                    aria-label={t("substitutions.actions.approveRow", names)}
                    onClick={() => {
                      onAction(record, "approve");
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
                    aria-label={t("substitutions.actions.rejectRow", names)}
                    onClick={() => {
                      onAction(record, "reject");
                    }}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </>
              )}
              {cancellable && (
                <Button
                  variant="secondary"
                  appearance="light"
                  mode="icon"
                  shape="circle"
                  size="sm"
                  aria-label={t("substitutions.actions.cancelRow", names)}
                  onClick={() => {
                    onAction(record, "cancel");
                  }}
                >
                  <Ban className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          );
        },
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, locale, cellLabel, canDecide, user, today, onAction],
  );
}
