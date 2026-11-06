import type { ExamSubjectRecord } from "@/services";
import { EXAM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";
import { CLASS_ID, SUBJECT_ID } from "@/test-fixtures/academics";

export { CLASS_ID, SUBJECT_ID };

export const OTHER_CLASS_ID = "df708192-a3b4-45c6-b0d1-5c6d7e8f9001";
export const OTHER_SUBJECT_ID = "f192a3b4-c5d6-47e8-92f3-7e8f90011223";
export const EXAM_SUBJECT_ID = "02a3b4c5-d6e7-48f9-a304-8f9001122334";

/** Mathematics in Grade 5: out of 100, pass at 40, no practical part. */
export function subjectRecord(overrides: Partial<ExamSubjectRecord> = {}): ExamSubjectRecord {
  return {
    id: EXAM_SUBJECT_ID,
    exam_id: EXAM_ID,
    exam_name: "Term 1 Midterm",
    class_id: CLASS_ID,
    class_name: "Grade 5",
    subject_id: SUBJECT_ID,
    subject_name: "Mathematics",
    max_marks: "100.00",
    pass_marks: "40.00",
    has_practical: false,
    practical_max_marks: null,
    practical_pass_marks: null,
    subject_weightage_percent: "100.00",
    marks_entry_opens_at: null,
    marks_entry_closes_at: null,
    marks_locked_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}
