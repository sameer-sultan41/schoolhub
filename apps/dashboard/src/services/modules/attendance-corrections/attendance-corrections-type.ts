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
