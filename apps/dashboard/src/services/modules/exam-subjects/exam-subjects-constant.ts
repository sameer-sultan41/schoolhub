import { EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import type { ExamSubjectInput } from "./exam-subjects-type";

/** The exam-subjects module's constants. */

/** A subject's marks sit under the exams module's key, so an exam write refreshes them. */
export const EXAM_SUBJECTS_QUERY_MODULE = EXAMS_QUERY_MODULE;
export const EXAM_SUBJECTS_LIST_RESOURCE = "subjects";

/** The columns (`examinations.models.ExamSubject`): six digits, two after the point. */
export const MARKS_PATTERN = /^\d{1,4}(\.\d{1,2})?$/;
export const DEFAULT_SUBJECT_WEIGHTAGE = "100";

/** The browser's `datetime-local` value is `YYYY-MM-DDTHH:mm`: its first 16 characters. */
export const DATETIME_LOCAL_LENGTH = 16;

/** camelCase `ExamSubjectInput` key -> the API's body key. */
export const EXAM_SUBJECTS_BODY_FIELDS: ReadonlyArray<readonly [keyof ExamSubjectInput, string]> = [
  ["examId", "exam_id"],
  ["classId", "class_id"],
  ["subjectId", "subject_id"],
  ["maxMarks", "max_marks"],
  ["passMarks", "pass_marks"],
  ["hasPractical", "has_practical"],
  ["practicalMaxMarks", "practical_max_marks"],
  ["practicalPassMarks", "practical_pass_marks"],
  ["subjectWeightagePercent", "subject_weightage_percent"],
  ["marksEntryOpensAt", "marks_entry_opens_at"],
  ["marksEntryClosesAt", "marks_entry_closes_at"],
];

/** The fields a server error may name on the subject form. The duplicate (exam, class, subject)
 * refusal lands under `subject_id`; any other field shows as the form's own message. */
export const EXAM_SUBJECT_ERROR_FIELDS = [
  "class_id",
  "subject_id",
  "max_marks",
  "pass_marks",
  "practical_max_marks",
  "practical_pass_marks",
  "subject_weightage_percent",
  "marks_entry_opens_at",
  "marks_entry_closes_at",
] as const;
