"use client";

import { useTranslations } from "next-intl";
import { cn, Input, ToggleGroup, ToggleGroupItem } from "@schoolhub/ui";

import type { StudentAttendanceRecord } from "@/services";
import {
  ATTENDANCE_REMARKS_MAX_LENGTH,
  MARKABLE_STATUSES,
} from "@/services/modules/student-attendance/student-attendance-constant";
import { isMarkableStatus } from "@/services/modules/student-attendance/student-attendance-helper";
import {
  ATTENDANCE_STATUS_ICON,
  ATTENDANCE_STATUS_SELECTED_CLASS,
} from "@/features/attendance/attendance-status";
import { ReadOnlyStatus } from "@/features/attendance/read-only-status";
import type { RegisterRowState, RowDraft } from "./use-register-form";

export interface RegisterRowProps {
  row: RegisterRowState;
  onEdit: (studentId: string, patch: Partial<RowDraft>) => void;
  /** Set when the viewer may ask for a locked row to change (`attendance.correction.create`). */
  onRequestCorrection?: (record: StudentAttendanceRecord) => void;
  /** True while a submission is in flight: an edit then would be lost when it lands. */
  disabled: boolean;
}

/**
 * One student on the register: roll, name and admission number, then either the status toggle
 * with its times and remarks, or the saved status read-only (leave, a locked row, a date that
 * can't be marked). Check-in shows for `late` and check-out for `half_day`, or whenever the row
 * already holds one, so a saved time is never sent unseen.
 */
export function RegisterRow({ row, onEdit, onRequestCorrection, disabled }: RegisterRowProps) {
  const t = useTranslations("attendance");
  const { entry, mode, draft, issue, leavesBeforeArriving } = row;
  const id = entry.student_id;
  const name = entry.student_name;
  const issueId = `register-issue-${id}`;
  const timeErrorId = `register-time-error-${id}`;
  const showCheckIn = draft.status === "late" || draft.checkInTime !== "";
  const showCheckOut = draft.status === "half_day" || draft.checkOutTime !== "";

  return (
    <li className={cn("space-y-3 p-4", (issue || leavesBeforeArriving) && "bg-destructive/5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap gap-x-2 font-medium">
            {entry.roll_number && (
              <>
                <span className="text-muted-foreground tabular-nums">
                  {t("register.roll", { roll: entry.roll_number })}
                </span>{" "}
              </>
            )}
            <span>{name}</span>
          </p>
          <p className="text-xs text-muted-foreground">{entry.admission_number}</p>
        </div>
        {mode === "editable" ? (
          <ToggleGroup
            type="single"
            size="sm"
            value={draft.status}
            disabled={disabled}
            aria-label={t("register.statusFor", { name })}
            aria-describedby={issue ? issueId : undefined}
            className="flex-wrap"
            onValueChange={(value) => {
              // Radix clears a single toggle clicked twice; a marked row stays marked.
              if (isMarkableStatus(value)) onEdit(id, { status: value });
            }}
          >
            {MARKABLE_STATUSES.map((status) => {
              const Icon = ATTENDANCE_STATUS_ICON[status];
              return (
                <ToggleGroupItem
                  key={status}
                  value={status}
                  className={cn("border border-input", ATTENDANCE_STATUS_SELECTED_CLASS[status])}
                >
                  <Icon aria-hidden="true" />
                  {t(`status.${status}`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        ) : (
          <ReadOnlyStatus
            record={entry.record}
            name={name}
            mode={mode}
            onRequestCorrection={onRequestCorrection}
          />
        )}
      </div>
      {mode === "editable" && (
        <div className="grid gap-2 sm:grid-cols-3">
          {showCheckIn && (
            <Input
              type="time"
              value={draft.checkInTime}
              disabled={disabled}
              aria-label={t("register.checkInFor", { name })}
              onChange={(event) => {
                onEdit(id, { checkInTime: event.target.value });
              }}
            />
          )}
          {showCheckOut && (
            <Input
              type="time"
              value={draft.checkOutTime}
              disabled={disabled}
              aria-label={t("register.checkOutFor", { name })}
              aria-invalid={leavesBeforeArriving || undefined}
              aria-describedby={leavesBeforeArriving ? timeErrorId : undefined}
              onChange={(event) => {
                onEdit(id, { checkOutTime: event.target.value });
              }}
            />
          )}
          <Input
            value={draft.remarks}
            maxLength={ATTENDANCE_REMARKS_MAX_LENGTH}
            disabled={disabled}
            placeholder={t("correction.fields.remarks")}
            aria-label={t("register.remarksFor", { name })}
            onChange={(event) => {
              onEdit(id, { remarks: event.target.value });
            }}
          />
        </div>
      )}
      {leavesBeforeArriving && (
        <p id={timeErrorId} className="text-sm text-destructive">
          {t("register.leavesBeforeArriving")}
        </p>
      )}
      {issue && (
        <p id={issueId} className="text-sm text-destructive">
          {issue}
        </p>
      )}
    </li>
  );
}
