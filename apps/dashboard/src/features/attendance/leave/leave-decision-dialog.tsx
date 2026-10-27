"use client";

import { useTranslations } from "next-intl";

import { DecisionDialog } from "@/features/attendance/decision-dialog";
import { useLeaveDates } from "@/features/attendance/leave/use-leave-dates";
import { Services, type LeaveAction, type LeaveRequestRecord } from "@/services";
import {
  LEAVE_DECISION_ERROR_FIELDS,
  LEAVE_NOTE_MAX_LENGTH,
  LEAVE_QUERY_MODULE,
} from "@/services/modules/leave-requests/leave-requests-constant";
import { leaveDecisionOutcome } from "@/services/modules/leave-requests/leave-requests-helper";
import { createLeaveDecisionSchema } from "@/services/modules/leave-requests/leave-requests.schema";
import { STUDENT_ATTENDANCE_QUERY_MODULE } from "@/services/modules/student-attendance/student-attendance-constant";

export interface LeaveDecisionDialogProps {
  request: LeaveRequestRecord;
  action: LeaveAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Approves or rejects the current step of one pending leave request, with an optional note, on
 * `DecisionDialog` (inline refusals in the server's own words, the 409 race). The toast says
 * what the decision did: how many days were marked, or that the request now waits for the next
 * level.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function LeaveDecisionDialog({
  request,
  action,
  open,
  onOpenChange,
}: LeaveDecisionDialogProps) {
  const t = useTranslations("attendance");
  const leaveDates = useLeaveDates();

  return (
    <DecisionDialog
      open={open}
      onOpenChange={onOpenChange}
      copy={{
        title: t(`leave.decision.${action}.title`),
        description: t(`leave.decision.${action}.description`, {
          name: request.student_name,
          dates: leaveDates(request),
          level: request.current_approval_level,
          total: request.approvals.length,
        }),
        submit: t(`leave.decision.${action}.submit`),
        submitting: t(`leave.decision.${action}.submitting`),
        note: t("leave.decision.note"),
        noteHint: t("leave.decision.noteHint"),
        noteTooLong: t("leave.decision.noteTooLong"),
      }}
      createSchema={createLeaveDecisionSchema}
      noteField="note"
      noteMaxLength={LEAVE_NOTE_MAX_LENGTH}
      knownFields={LEAVE_DECISION_ERROR_FIELDS}
      decide={(note) => Services.leaveRequests.decideLeave(request.id, action, note)}
      queueModule={LEAVE_QUERY_MODULE}
      // An approval auto-marks the request's days in the attendance records.
      alsoRefresh={action === "approve" ? [STUDENT_ATTENDANCE_QUERY_MODULE] : []}
      successMessage={(result) => {
        const { key, values } = leaveDecisionOutcome(action, result);
        return t(`leave.decision.${key}`, values);
      }}
    />
  );
}
