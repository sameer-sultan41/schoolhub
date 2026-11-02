import { EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import type { ConflictSeverity, SittingInput, SittingStatus } from "./exam-schedules-type";

/** The exam-schedules module's constants. */

/** The sittings sit under the exams module's key, so an exam write (or a publish, which moves the
 * exam's status) refreshes them, and a sitting write refreshes the exam's own reads. */
export const EXAM_SCHEDULES_QUERY_MODULE = EXAMS_QUERY_MODULE;
export const SITTINGS_LIST_RESOURCE = "sittings";
export const SCHEDULE_CONFLICTS_RESOURCE = "schedule-conflicts";

export const SITTING_STATUS_SCHEDULED: SittingStatus = "scheduled";
export const SITTING_STATUS_CANCELLED: SittingStatus = "cancelled";

/** The severities the API sends; a finding with any other counts as hard (it blocks, never hides). */
export const CONFLICT_SEVERITIES: readonly ConflictSeverity[] = ["hard", "soft"];

/** camelCase `SittingInput` key -> the API's body key. */
export const SITTING_BODY_FIELDS: ReadonlyArray<readonly [keyof SittingInput, string]> = [
  ["examSubjectId", "exam_subject_id"],
  ["sectionId", "section_id"],
  ["examDate", "exam_date"],
  ["startTime", "start_time"],
  ["endTime", "end_time"],
  ["roomId", "room_id"],
  ["invigilatorStaffId", "invigilator_staff_id"],
];

/** The fields a server error may name on the sitting form: every one has an input. */
export const SITTING_ERROR_FIELDS = [
  "exam_subject_id",
  "section_id",
  "exam_date",
  "start_time",
  "end_time",
  "room_id",
  "invigilator_staff_id",
] as const;

/** `HH:MM:SS` -> `HH:MM`: the length of a `time` input's value. */
export const SHORT_TIME_LENGTH = 5;
