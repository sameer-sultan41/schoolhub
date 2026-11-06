import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). The ids of the exam, and every `*_name`, are read-only. */
export type SittingRecord = ApiSchemas["ExamSchedule"];
export type SittingStatus = ApiSchemas["ExamScheduleStatusEnum"];
export type ExamConflict = ApiSchemas["ExamConflict"];
export type ExamConflictType = ApiSchemas["ExamConflictTypeEnum"];
export type ConflictSeverity = ApiSchemas["ConflictSeverityEnum"];
export type SchedulePublishResult = ApiSchemas["ExamSchedulePublish"];

/** One sitting's write. A null room or invigilator clears it. */
export interface SittingInput {
  examSubjectId: string;
  sectionId: string;
  examDate: string;
  startTime: string;
  endTime: string;
  roomId: string | null;
  invigilatorStaffId: string | null;
}

/** Every sitting write answers with the exam's whole clash list in `meta.conflicts`. */
export interface SittingWriteResult {
  sitting: SittingRecord;
  conflicts: ExamConflict[];
}

/** One day's sittings, in start-time order. */
export interface SittingDay {
  date: string;
  sittings: SittingRecord[];
}
