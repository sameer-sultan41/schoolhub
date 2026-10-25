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

export interface RequestCorrectionInput {
  studentAttendanceId: string;
  newValues: CorrectionNewValues;
  reason: string;
}

export type CorrectionStatus = AttendanceCorrectionRecord["status"];

/** The two decisions, each its own route (`:approve`, `:reject`). */
export type CorrectionAction = "approve" | "reject";

/** One cursor page of the corrections list. `mine`: `true` is the caller's own requests, left
 * out is everyone's. (The API also takes `false`, everyone else's; the dashboard never sends it.) */
export interface CorrectionPageQuery {
  cursor?: string;
  pageSize?: number;
  ordering?: string;
  status?: CorrectionStatus;
  mine?: true;
}

/** A correctable field and its value before and after, as the diff shows it. */
export interface CorrectionChange {
  field: keyof CorrectionNewValues;
  from: string | null;
  to: string | null;
}
