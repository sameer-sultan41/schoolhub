"use client";

import { useLocale, useTranslations } from "next-intl";

import { DecisionDialog } from "@/features/attendance/decision-dialog";
import { EMPTY_VALUE } from "@/lib/constants";
import { formatDate } from "@/lib/helpers";
import { Services, type AttendanceCorrectionRecord, type CorrectionAction } from "@/services";
import {
  CORRECTION_DECISION_ERROR_FIELDS,
  CORRECTION_REVIEW_NOTE_MAX_LENGTH,
  CORRECTIONS_QUERY_MODULE,
} from "@/services/modules/attendance-corrections/attendance-corrections-constant";
import { correctionSubjectName } from "@/services/modules/attendance-corrections/attendance-corrections-helper";
import { createDecisionFormSchema } from "@/services/modules/attendance-corrections/attendance-corrections.schema";
import { STUDENT_ATTENDANCE_QUERY_MODULE } from "@/services/modules/student-attendance/student-attendance-constant";
import { STAFF_ATTENDANCE_QUERY_MODULE } from "@/services/modules/staff-attendance/staff-attendance-constant";

export interface CorrectionDecisionDialogProps {
  record: AttendanceCorrectionRecord;
  action: CorrectionAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Approves or rejects one pending correction, with an optional note to the requester, on
 * `DecisionDialog` (inline refusals, the 409 race). An approval also reloads the attendance
 * records the correction rewrites.
 *
 * Mounting contract: the caller mounts this only while it is open.
 */
export function CorrectionDecisionDialog({
  record,
  action,
  open,
  onOpenChange,
}: CorrectionDecisionDialogProps) {
  const t = useTranslations("attendance");
  const locale = useLocale();

  // An approval rewrites the attendance record the correction names, a student's or staff's.
  const attendanceModule =
    record.subject_type === "staff"
      ? STAFF_ATTENDANCE_QUERY_MODULE
      : STUDENT_ATTENDANCE_QUERY_MODULE;

  return (
    <DecisionDialog
      open={open}
      onOpenChange={onOpenChange}
      copy={{
        title: t(`corrections.decision.${action}.title`),
        description: t(`corrections.decision.${action}.description`, {
          name: correctionSubjectName(record) ?? EMPTY_VALUE,
          date: record.attendance_date ? formatDate(record.attendance_date, locale) : EMPTY_VALUE,
        }),
        submit: t(`corrections.decision.${action}.submit`),
        submitting: t(`corrections.decision.${action}.submitting`),
        note: t("corrections.decision.note"),
        noteHint: t("corrections.decision.noteHint"),
        noteTooLong: t("corrections.decision.noteTooLong"),
      }}
      createSchema={createDecisionFormSchema}
      noteField="review_note"
      noteMaxLength={CORRECTION_REVIEW_NOTE_MAX_LENGTH}
      knownFields={CORRECTION_DECISION_ERROR_FIELDS}
      decide={(note) => Services.attendanceCorrections.decideCorrection(record.id, action, note)}
      queueModule={CORRECTIONS_QUERY_MODULE}
      alsoRefresh={action === "approve" ? [attendanceModule] : []}
      successMessage={() => t(`corrections.decision.${action}.done`)}
    />
  );
}
