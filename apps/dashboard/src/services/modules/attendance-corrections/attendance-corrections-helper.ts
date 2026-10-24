import { toShortTime } from "@/services/modules/periods/periods-helper";
import { isMarkableStatus } from "@/services/modules/student-attendance/student-attendance-helper";
import type { StudentAttendanceRecord } from "@/services/modules/student-attendance/student-attendance-type";
import type { CorrectionFormValues } from "./attendance-corrections.schema";
import type { CorrectionNewValues, RequestCorrectionInput } from "./attendance-corrections-type";

/** The attendance-corrections module's pure helpers. */

export function toCorrectionBody(input: RequestCorrectionInput): Record<string, unknown> {
  return {
    student_attendance_id: input.studentAttendanceId,
    new_values: input.newValues,
    reason: input.reason,
  };
}

/** A record's correctable values as the form holds them: times as `HH:MM`, blanks as `""`. */
export function recordToCorrectionValues(record: StudentAttendanceRecord): CorrectionFormValues {
  return {
    new_values: {
      status: isMarkableStatus(record.status) ? record.status : "",
      check_in_time: record.check_in_time ? toShortTime(record.check_in_time) : "",
      check_out_time: record.check_out_time ? toShortTime(record.check_out_time) : "",
      remarks: record.remarks ?? "",
    },
    reason: "",
  };
}

/**
 * Only the values that differ from the record, a cleared one as `null`. Empty means there is
 * nothing to request: the server refuses a proposal that matches the record (§11).
 */
export function buildCorrectionNewValues(
  values: CorrectionFormValues,
  record: StudentAttendanceRecord,
): CorrectionNewValues {
  const current = recordToCorrectionValues(record).new_values;
  const next = values.new_values;
  const changes: CorrectionNewValues = {};
  if (next.status !== "" && next.status !== current.status) changes.status = next.status;
  if (next.check_in_time !== current.check_in_time) {
    changes.check_in_time = next.check_in_time || null;
  }
  if (next.check_out_time !== current.check_out_time) {
    changes.check_out_time = next.check_out_time || null;
  }
  const remarks = next.remarks.trim();
  if (remarks !== current.remarks.trim()) changes.remarks = remarks || null;
  return changes;
}
