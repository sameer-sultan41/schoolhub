import type { AuthenticatedUser } from "@schoolhub/types";

import { canDecidePending, isViewer, statusFilterValue } from "@/lib/approval-queue";
import { copyMappedFields } from "@/lib/helpers";
import { toShortTime } from "@/services/modules/periods/periods-helper";
import { isMarkableStatus } from "@/services/modules/student-attendance/student-attendance-helper";
import type { MarkableStatus } from "@/services/modules/student-attendance/student-attendance-type";
import type { CorrectionFormValues } from "./attendance-corrections.schema";
import {
  CORRECTION_CHANGE_FIELDS,
  CORRECTION_QUERY_FIELDS,
  CORRECTIONS_MINE,
} from "./attendance-corrections-constant";
import type {
  AttendanceCorrectionRecord,
  CorrectableRecord,
  CorrectionChange,
  CorrectionNewValues,
  CorrectionPageQuery,
  CorrectionStatus,
  RequestCorrectionInput,
} from "./attendance-corrections-type";

/** The attendance-corrections module's pure helpers. */

/** The request body: the one row it names, by the key of its kind. */
export function toCorrectionBody(input: RequestCorrectionInput): Record<string, unknown> {
  const target =
    input.staffAttendanceId !== undefined
      ? { staff_attendance_id: input.staffAttendanceId }
      : { student_attendance_id: input.studentAttendanceId };
  return { ...target, new_values: input.newValues, reason: input.reason };
}

/**
 * A record's correctable values as the form holds them: times as `HH:MM`, blanks as `""`.
 * `isSettable` says which statuses the form may hold (a student's by default); any other
 * status starts as `""`, so one is picked before it is sent.
 */
export function recordToCorrectionValues(
  record: CorrectableRecord,
  isSettable: (status: string) => status is MarkableStatus = isMarkableStatus,
): CorrectionFormValues {
  return {
    new_values: {
      status: isSettable(record.status) ? record.status : "",
      check_in_time: record.check_in_time ? toShortTime(record.check_in_time) : "",
      check_out_time: record.check_out_time ? toShortTime(record.check_out_time) : "",
      remarks: record.remarks ?? "",
    },
    reason: "",
  };
}

/**
 * Only the values that differ from the record, a cleared one as `null`, among `fields` (every
 * correctable field by default; a staff row's leave out remarks). Empty means there is nothing
 * to request: the server refuses a proposal that matches the record (§11).
 */
export function buildCorrectionNewValues(
  values: CorrectionFormValues,
  record: CorrectableRecord,
  fields: readonly (keyof CorrectionNewValues)[] = CORRECTION_CHANGE_FIELDS,
): CorrectionNewValues {
  // A status the form can't hold reads as "", which no picked status equals.
  const current = recordToCorrectionValues(record).new_values;
  const next = values.new_values;
  const changes: CorrectionNewValues = {};
  if (fields.includes("status") && next.status !== "" && next.status !== current.status) {
    changes.status = next.status;
  }
  if (fields.includes("check_in_time") && next.check_in_time !== current.check_in_time) {
    changes.check_in_time = next.check_in_time || null;
  }
  if (fields.includes("check_out_time") && next.check_out_time !== current.check_out_time) {
    changes.check_out_time = next.check_out_time || null;
  }
  const remarks = next.remarks.trim();
  if (fields.includes("remarks") && remarks !== current.remarks.trim()) {
    changes.remarks = remarks || null;
  }
  return changes;
}

/** Whose row a correction is for: the student's name, else the staff member's. */
export function correctionSubjectName(correction: AttendanceCorrectionRecord): string | null {
  return correction.student_name ?? correction.staff_name ?? null;
}

export function toCorrectionQueryParams(
  query: CorrectionPageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  copyMappedFields(
    query,
    CORRECTION_QUERY_FIELDS,
    (value) => value !== undefined && value !== "",
    params,
  );
  return params as Record<string, string | number | boolean | undefined>;
}

/** The status filter -> `status`: `all` is no filter. */
export function statusFilterToStatus(value: string): CorrectionStatus | undefined {
  return statusFilterValue(value) as CorrectionStatus | undefined;
}

/**
 * The Mine checkbox -> `mine`: checked is the caller's own requests (`true`), unchecked is no
 * filter (`undefined`). The UI has no "everyone else's" control, so `mine: false` is never sent.
 */
export function mineFilterToMine(value: string): true | undefined {
  return value === CORRECTIONS_MINE ? true : undefined;
}

/** Whether `user` was the one who asked: the server refuses their own request a decision. */
export function isOwnCorrection(
  correction: AttendanceCorrectionRecord,
  user: AuthenticatedUser | undefined,
): boolean {
  return isViewer(correction.requested_by, user);
}

/** Whether `user` is the staff member a correction is about: the server refuses them a decision. */
export function isOwnAttendanceCorrection(
  correction: AttendanceCorrectionRecord,
  user: AuthenticatedUser | undefined,
): boolean {
  return user !== undefined && correction.subject_user_id === user.id;
}

/** Whether Approve and Reject are offered: a pending request, from someone else and not about
 * the viewer's own attendance, to a holder of `attendance.correction.approve`. The server
 * enforces each of these itself. */
export function canDecideCorrection(
  correction: AttendanceCorrectionRecord,
  user: AuthenticatedUser | undefined,
  canApprove: boolean,
): boolean {
  return (
    canDecidePending(correction, user, canApprove) &&
    !isOwnCorrection(correction, user) &&
    !isOwnAttendanceCorrection(correction, user)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

const TIME_FIELDS: readonly string[] = ["check_in_time", "check_out_time"];

/** A stored value as text: a time as `HH:MM`, and a blank or absent value as `null`. */
function toChangeValue(field: string, value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return TIME_FIELDS.includes(field) ? toShortTime(value) : value;
}

/**
 * The fields a request changes, from `old_values` to `new_values`, in the form's order. A key
 * that is named but equals the record's value is not a change, so it is left out.
 */
export function correctionChanges(correction: AttendanceCorrectionRecord): CorrectionChange[] {
  const before = asRecord(correction.old_values);
  const after = asRecord(correction.new_values);
  return CORRECTION_CHANGE_FIELDS.flatMap((field) => {
    if (!(field in after)) return [];
    const from = toChangeValue(field, before[field]);
    const to = toChangeValue(field, after[field]);
    return from === to ? [] : [{ field, from, to }];
  });
}
