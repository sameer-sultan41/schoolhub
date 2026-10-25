import type { AuthenticatedUser } from "@schoolhub/types";

import { FILTER_ALL } from "@/lib/constants";
import { copyMappedFields } from "@/lib/helpers";
import { toShortTime } from "@/services/modules/periods/periods-helper";
import { isMarkableStatus } from "@/services/modules/student-attendance/student-attendance-helper";
import type { StudentAttendanceRecord } from "@/services/modules/student-attendance/student-attendance-type";
import type { CorrectionFormValues } from "./attendance-corrections.schema";
import {
  CORRECTION_CHANGE_FIELDS,
  CORRECTION_QUERY_FIELDS,
  CORRECTION_STATUS_PENDING,
  CORRECTIONS_MINE,
} from "./attendance-corrections-constant";
import type {
  AttendanceCorrectionRecord,
  CorrectionChange,
  CorrectionNewValues,
  CorrectionPageQuery,
  CorrectionStatus,
  RequestCorrectionInput,
} from "./attendance-corrections-type";

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

export function toCorrectionQueryParams(
  query: CorrectionPageQuery,
): Record<string, string | number | boolean | undefined> {
  const params: Record<string, unknown> = { page_size: query.pageSize };
  // `mine: false` is a real filter (everyone else's), so only undefined or blank is left out.
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
  return value === FILTER_ALL ? undefined : (value as CorrectionStatus);
}

/** The Mine filter -> `mine`: off is no filter, so the queue shows everyone's requests. */
export function mineFilterToMine(value: string): true | undefined {
  return value === CORRECTIONS_MINE ? true : undefined;
}

/** The `:approve` / `:reject` body: the note when there is one, an empty body otherwise. */
export function toDecisionBody(reviewNote?: string): Record<string, unknown> {
  const note = reviewNote?.trim();
  return note ? { review_note: note } : {};
}

/** Whether `user` was the one who asked: the server refuses their own request a decision. */
export function isOwnCorrection(
  correction: AttendanceCorrectionRecord,
  user: AuthenticatedUser | undefined,
): boolean {
  return user !== undefined && correction.requested_by === user.id;
}

/** Whether Approve and Reject are offered: a pending request, from someone else, to a holder
 * of `attendance.correction.approve`. The server enforces each of these itself. */
export function canDecideCorrection(
  correction: AttendanceCorrectionRecord,
  user: AuthenticatedUser | undefined,
  canApprove: boolean,
): boolean {
  return (
    user !== undefined &&
    canApprove &&
    correction.status === CORRECTION_STATUS_PENDING &&
    !isOwnCorrection(correction, user)
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
