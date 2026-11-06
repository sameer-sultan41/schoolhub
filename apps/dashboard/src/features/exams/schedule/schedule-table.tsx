"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge, Button, cn, TableCell, TableRow, type BadgeProps } from "@schoolhub/ui";
import {
  Ban,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { RowEditRemoveActions } from "@/components/row-edit-remove-actions";
import { EMPTY_VALUE } from "@/lib/constants";
import type {
  ExamConflict,
  ExamRecord,
  SittingDay,
  SittingRecord,
  SittingStatus,
} from "@/services";
import {
  formatSittingDate,
  isSittingOpen,
  toShortTime,
  worstSeverity,
} from "@/services/modules/exam-schedules/exam-schedules-helper";
import { SITTING_STATUS_SCHEDULED } from "@/services/modules/exam-schedules/exam-schedules-constant";
import { GroupTableCard } from "@/features/exams/group-table-card";
import { SittingActionDialog, type SittingAction } from "./sitting-action-dialog";
import { SittingFormDialog } from "./sitting-form-dialog";

const COLUMN_KEYS = ["time", "subject", "section", "room", "invigilator", "status"] as const;

const STATUS_STYLE: Record<
  SittingStatus,
  { icon: LucideIcon; variant: NonNullable<BadgeProps["variant"]> }
> = {
  scheduled: { icon: CalendarClock, variant: "info" },
  completed: { icon: CircleCheck, variant: "success" },
  cancelled: { icon: Ban, variant: "secondary" },
};

/** A sitting's status as token colour, icon and label together. */
function SittingStatusBadge({ status }: { status: SittingStatus }) {
  const t = useTranslations("exams");
  const { icon: Icon, variant } = STATUS_STYLE[status];

  return (
    <Badge variant={variant} appearance="light">
      <Icon aria-hidden="true" />
      {t(`schedule.status.${status}`)}
    </Badge>
  );
}

/** The marker on a sitting a finding names: icon and word, never colour alone. */
function ClashMarker({ severity }: { severity: "hard" | "soft" }) {
  const t = useTranslations("exams");
  const isHard = severity === "hard";
  const Icon = isHard ? CircleAlert : TriangleAlert;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isHard ? "text-danger" : "text-warning",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {t(`schedule.clash.${severity}`)}
    </span>
  );
}

export interface ScheduleTableProps {
  exam: ExamRecord;
  days: readonly SittingDay[];
  /** Each sitting's findings, by sitting id, for the clash marker. */
  conflictsBySitting: ReadonlyMap<string, readonly ExamConflict[]>;
  /** Reschedule: `exams.schedule.update` and an exam still up to `scheduled`. */
  canEdit: boolean;
  /** Call a sitting off: `exams.schedule.update`. */
  canCancel: boolean;
  /** Delete: `exams.schedule.update` on a draft exam. */
  canDelete: boolean;
}

/**
 * The exam's sittings, one card per date and each date's sittings by start time, a clash marker
 * on any sitting a finding names. Row actions apply only to a sitting still `scheduled` (the
 * server refuses a completed or cancelled one) and to what the viewer's keys and the exam's
 * state allow. Each dialog is mounted only while open.
 */
export function ScheduleTable({
  exam,
  days,
  conflictsBySitting,
  canEdit,
  canCancel,
  canDelete,
}: ScheduleTableProps) {
  const t = useTranslations("exams");
  const locale = useLocale();
  const [editTarget, setEditTarget] = useState<SittingRecord | null>(null);
  const [action, setAction] = useState<{ kind: SittingAction; record: SittingRecord } | null>(null);
  const hasActions = canEdit || canCancel || canDelete;
  const columns = COLUMN_KEYS.map((key) => ({ key, label: t(`schedule.columns.${key}`) }));

  return (
    <div className="space-y-5">
      {days.map((day) => (
        <GroupTableCard
          key={day.date}
          title={formatSittingDate(day.date, locale)}
          columns={columns}
          hasActions={hasActions}
        >
          {day.sittings.map((sitting) => {
            const severity = worstSeverity(conflictsBySitting.get(sitting.id));
            const status = sitting.status ?? SITTING_STATUS_SCHEDULED;
            const open = isSittingOpen(sitting);
            const names = {
              subject: sitting.subject_name,
              class: sitting.class_name,
              section: sitting.section_name,
            };
            return (
              <TableRow key={sitting.id}>
                <TableCell className="whitespace-nowrap">
                  {t("schedule.timeRange", {
                    start: toShortTime(sitting.start_time),
                    end: toShortTime(sitting.end_time),
                  })}
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex flex-wrap items-center gap-2">
                    {sitting.subject_name}
                    {severity && <ClashMarker severity={severity} />}
                  </div>
                </TableCell>
                <TableCell>
                  {t("schedule.classSection", {
                    class: sitting.class_name,
                    section: sitting.section_name,
                  })}
                </TableCell>
                <TableCell>{sitting.room_name ?? EMPTY_VALUE}</TableCell>
                <TableCell>{sitting.invigilator_name ?? EMPTY_VALUE}</TableCell>
                <TableCell>
                  <SittingStatusBadge status={status} />
                </TableCell>
                {hasActions && (
                  <TableCell>
                    {open && (
                      <div className="flex items-center gap-1">
                        <RowEditRemoveActions
                          editLabel={canEdit ? t("schedule.actions.editRow", names) : undefined}
                          onEdit={() => {
                            setEditTarget(sitting);
                          }}
                          removeLabel={
                            canDelete ? t("schedule.actions.deleteRow", names) : undefined
                          }
                          onRemove={() => {
                            setAction({ kind: "delete", record: sitting });
                          }}
                        />
                        {canCancel && (
                          <Button
                            variant="secondary"
                            appearance="light"
                            mode="icon"
                            shape="circle"
                            size="sm"
                            aria-label={t("schedule.actions.cancelRow", names)}
                            onClick={() => {
                              setAction({ kind: "cancel", record: sitting });
                            }}
                          >
                            <Ban className="size-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </GroupTableCard>
      ))}
      {editTarget && (
        <SittingFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          exam={exam}
          record={editTarget}
        />
      )}
      {action && (
        <SittingActionDialog
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          action={action.kind}
          record={action.record}
        />
      )}
    </div>
  );
}
