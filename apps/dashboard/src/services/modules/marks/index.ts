import {
  bulkEntry,
  fetchGrid,
  fetchProgress,
  fetchStudentMarks,
  importMarks,
  lockMarks,
  unlockMarks,
} from "./marks-service";

export const MarksService = {
  fetchGrid,
  bulkEntry,
  fetchProgress,
  fetchStudentMarks,
  lockMarks,
  unlockMarks,
  importMarks,
};
export type {
  BulkMarksEntryInput,
  BulkMarksEntryResult,
  MarksEntryInput,
  MarksEntryStatus,
  MarksGrid,
  MarksGridEntry,
  MarksGridMeta,
  MarksGridQuery,
  MarksLockResult,
  MarksProgressRow,
  MarksRecord,
  MarksUnlockResult,
  MarksUnwritableReason,
} from "./marks-type";
