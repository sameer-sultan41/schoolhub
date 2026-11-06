import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shape (ADR-0017). The names and `marks_locked_at` are read-only. */
export type ExamSubjectRecord = ApiSchemas["ExamSubject"];

/** Marks and weightage are decimal strings, as the API sends them; a null clears one. The
 * practical marks are sent only for a `hasPractical` subject. */
export interface ExamSubjectInput {
  examId: string;
  classId: string;
  subjectId: string;
  maxMarks: string;
  passMarks: string;
  hasPractical: boolean;
  practicalMaxMarks: string | null;
  practicalPassMarks: string | null;
  subjectWeightagePercent: string;
  marksEntryOpensAt: string | null;
  marksEntryClosesAt: string | null;
}

/** A class's subjects on one exam, in the order the API sends them (class, then subject). */
export interface ExamSubjectGroup {
  classId: string;
  className: string;
  rows: ExamSubjectRecord[];
}
