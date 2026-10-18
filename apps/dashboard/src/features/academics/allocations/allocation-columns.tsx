"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, BadgeDot, Button, DataGridColumnHeader, Skeleton } from "@schoolhub/ui";
import { CalendarOff, Pencil, Trash2, Undo2 } from "lucide-react";

import { formatDate, todayIsoDate } from "@/lib/helpers";
import type { TeacherAllocationRecord } from "@/services";
import {
  ALLOCATION_ACTIONS_COLUMN_ID,
  ALLOCATION_EMPTY_CELL,
  ALLOCATION_ROW_ACTION,
} from "@/services/modules/teacher-allocations/teacher-allocations-constant";
import {
  canEndAllocation,
  hasAllocationStarted,
  isAllocationEnded,
  isPrimaryAllocation,
} from "@/services/modules/teacher-allocations/teacher-allocations-helper";
import type { AllocationRowAction } from "@/services/modules/teacher-allocations/teacher-allocations-type";

interface AllocationRowActionsProps {
  record: TeacherAllocationRecord;
  canUpdate: boolean;
  canDelete: boolean;
  onAction: (action: AllocationRowAction, record: TeacherAllocationRecord) => void;
}

/**
 * One row's buttons: Edit always; End while current and started, Reinstate once ended (both
 * need `.update`); Remove always (`.delete`). A not-yet-started row has nothing to end.
 */
function AllocationRowActions({
  record,
  canUpdate,
  canDelete,
  onAction,
}: AllocationRowActionsProps) {
  const t = useTranslations("academics");
  const label = {
    teacher: record.staff_name,
    subject: record.subject_name,
    section: t("allocations.sectionLabel", {
      className: record.class_name,
      sectionName: record.section_name,
    }),
  };
  const canEnd = canUpdate && canEndAllocation(record, todayIsoDate());
  const canReinstate = canUpdate && isAllocationEnded(record);

  return (
    <div className="flex items-center gap-1">
      {canUpdate && (
        <Button
          variant="primary"
          appearance="light"
          mode="icon"
          shape="circle"
          size="sm"
          aria-label={t("allocations.actions.editRow", label)}
          onClick={() => {
            onAction(ALLOCATION_ROW_ACTION.edit, record);
          }}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
      )}
      {canEnd && (
        <Button
          variant="secondary"
          appearance="light"
          mode="icon"
          shape="circle"
          size="sm"
          aria-label={t("allocations.actions.endRow", label)}
          onClick={() => {
            onAction(ALLOCATION_ROW_ACTION.end, record);
          }}
        >
          <CalendarOff className="size-4" aria-hidden="true" />
        </Button>
      )}
      {canReinstate && (
        <Button
          variant="secondary"
          appearance="light"
          mode="icon"
          shape="circle"
          size="sm"
          aria-label={t("allocations.actions.reinstateRow", label)}
          onClick={() => {
            onAction(ALLOCATION_ROW_ACTION.reinstate, record);
          }}
        >
          <Undo2 className="size-4" aria-hidden="true" />
        </Button>
      )}
      {canDelete && (
        <Button
          variant="destructive"
          appearance="light"
          mode="icon"
          shape="circle"
          size="sm"
          aria-label={t("allocations.actions.deleteRow", label)}
          onClick={() => {
            onAction(ALLOCATION_ROW_ACTION.remove, record);
          }}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/**
 * The table's column defs (ids are the keys of `ALLOCATION_SORT_FIELD`), memoized: pass a
 * stable `onAction`. A locked session hides the actions column, so the flags are permissions only.
 */
export function useAllocationColumns(
  canUpdate: boolean,
  canDelete: boolean,
  onAction: (action: AllocationRowAction, record: TeacherAllocationRecord) => void,
): ColumnDef<TeacherAllocationRecord>[] {
  const t = useTranslations("academics");
  const locale = useLocale();

  return useMemo<ColumnDef<TeacherAllocationRecord>[]>(
    () => [
      {
        id: "section",
        accessorKey: "section_name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.section")} />
        ),
        cell: ({ row }) =>
          t("allocations.sectionLabel", {
            className: row.original.class_name,
            sectionName: row.original.section_name,
          }),
        meta: { headerTitle: t("fields.section"), skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "subject",
        accessorKey: "subject_name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.subject")} />
        ),
        meta: { headerTitle: t("fields.subject"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "teacher",
        accessorKey: "staff_name",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.teacher")} />
        ),
        meta: { headerTitle: t("fields.teacher"), skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "role",
        accessorKey: "is_primary",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("allocations.columns.role")} />
        ),
        // Soft, with a dot: one solid pill per row down a column reads as a wall of colour,
        // and the dot keeps the two roles apart without leaning on hue alone.
        cell: ({ row }) =>
          isPrimaryAllocation(row.original) ? (
            <Badge variant="primary" appearance="light">
              <BadgeDot />
              {t("allocations.primary")}
            </Badge>
          ) : (
            <Badge variant="secondary" appearance="light">
              <BadgeDot />
              {t("allocations.coTeacher")}
            </Badge>
          ),
        meta: {
          headerTitle: t("allocations.columns.role"),
          skeleton: <Skeleton className="h-5 w-24 rounded-full" />,
        },
      },
      {
        id: "weeklyPeriods",
        accessorKey: "weekly_periods",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("fields.weeklyPeriods")} />
        ),
        // No override: the curriculum's own target applies, so a dash that says so to a
        // screen reader.
        cell: ({ row }) => {
          const periods = row.original.weekly_periods ?? null;
          if (periods !== null) return periods;
          return (
            <span title={t("allocations.curriculumDefault")}>
              <span aria-hidden="true">{ALLOCATION_EMPTY_CELL}</span>
              <span className="sr-only">{t("allocations.curriculumDefault")}</span>
            </span>
          );
        },
        meta: {
          headerTitle: t("fields.weeklyPeriods"),
          skeleton: <Skeleton className="h-4 w-8" />,
        },
      },
      {
        id: "effectiveFrom",
        accessorKey: "effective_from",
        header: ({ column }) => (
          <DataGridColumnHeader column={column} title={t("allocations.columns.effective")} />
        ),
        // Ended, not started yet (so there is nothing to end), or in force.
        cell: ({ row }) => {
          const record = row.original;
          const endedOn = record.effective_to ?? null;
          if (endedOn !== null) {
            return t("allocations.endedOn", { date: formatDate(endedOn, locale) });
          }
          const startsOn = record.effective_from ?? null;
          if (startsOn !== null && !hasAllocationStarted(record, todayIsoDate())) {
            return t("allocations.startsOn", { date: formatDate(startsOn, locale) });
          }
          return t("allocations.current");
        },
        meta: {
          headerTitle: t("allocations.columns.effective"),
          skeleton: <Skeleton className="h-4 w-24" />,
        },
      },
      {
        id: ALLOCATION_ACTIONS_COLUMN_ID,
        header: "",
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <AllocationRowActions
            record={row.original}
            canUpdate={canUpdate}
            canDelete={canDelete}
            onAction={onAction}
          />
        ),
        meta: { skeleton: <Skeleton className="size-7 rounded-full" /> },
      },
    ],
    [t, locale, canUpdate, canDelete, onAction],
  );
}
