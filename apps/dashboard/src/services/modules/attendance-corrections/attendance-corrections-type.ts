import type { ApiSchemas } from "@schoolhub/api-client";

import type { MarkableStatus } from "@/services/modules/student-attendance/student-attendance-type";

/** The generated wire shape (ADR-0017). */
export type AttendanceCorrectionRecord = ApiSchemas["AttendanceCorrection"];

/** The fields a correction may propose (`services.CORRECTABLE_FIELDS`); a key left out keeps
 * its value. The keys are the wire's own, since this object is sent as it is. */
export interface CorrectionNewValues {
  status?: MarkableStatus;
  check_in_time?: string | null;
  check_out_time?: string | null;
  remarks?: string | null;
}

/** A request names exactly one row, a student's or a staff member's (the server refuses both or
 * neither). A staff proposal names no `remarks`. */
export type RequestCorrectionInput = {
  newValues: CorrectionNewValues;
  reason: string;
} & (
  | { studentAttendanceId: string; staffAttendanceId?: never }
  | { staffAttendanceId: string; studentAttendanceId?: never }
);

/** The values a correction starts from: a student's or a staff member's row. */
export interface CorrectableRecord {
  status: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
  remarks?: string | null;
}

export type CorrectionStatus = AttendanceCorrectionRecord["status"];

/** Whose row a correction names: a student's or a staff member's. */
export type CorrectionSubjectType = AttendanceCorrectionRecord["subject_type"];

/** The two decisions, each its own route (`:approve`, `:reject`). */
export type CorrectionAction = "approve" | "reject";

/** One cursor page of the corrections list. `mine`: `true` is the caller's own requests,
 * `false` everyone else's (the approver's queue), left out is both. */
export interface CorrectionPageQuery {
  cursor?: string;
  pageSize?: number;
  ordering?: string;
  status?: CorrectionStatus;
  mine?: boolean;
  subjectType?: CorrectionSubjectType;
}

/** A correctable field and its value before and after, as the diff shows it. */
export interface CorrectionChange {
  field: keyof CorrectionNewValues;
  from: string | null;
  to: string | null;
}
