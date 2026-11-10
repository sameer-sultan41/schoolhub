import { EXAMS_QUERY_MODULE } from "@/services/modules/exams/exams-constant";
import type { ExamStatus } from "@/services/modules/exams/exams-type";
import type { MarksEntryInput, MarksEntryStatus, MarksUnwritableReason } from "./marks-type";

/** The marks module's constants. */

/** Marks sit under the exams module's key: a first save moves the exam to `marks_entry`, so a
 * write refreshes the exam with the progress and the grid. */
export const MARKS_QUERY_MODULE = EXAMS_QUERY_MODULE;
export const MARKS_GRID_RESOURCE = "marks-grid";
export const MARKS_PROGRESS_RESOURCE = "marks-progress";

/** The exam tab's id, and the grid's URL keys (`?tab=marks&subject=&section=`). */
export const MARKS_TAB_ID = "marks";
export const MARKS_SUBJECT_URL_KEY = "subject";
export const MARKS_SECTION_URL_KEY = "section";

export const MARKS_STATUS_DRAFT: MarksEntryStatus = "draft";
export const MARKS_STATUS_SUBMITTED: MarksEntryStatus = "submitted";

/** Every `meta.unwritable_reason`, keyed so the compiler checks the set against the union. */
const UNWRITABLE_REASON_SET: Record<MarksUnwritableReason, true> = {
  exam_status: true,
  window_not_open: true,
  window_closed: true,
  locked: true,
  no_permission: true,
};
export const MARKS_UNWRITABLE_REASONS = Object.keys(
  UNWRITABLE_REASON_SET,
) as MarksUnwritableReason[];

/** `MarksEntrySerializer`'s mark fields are `max_digits=6, decimal_places=2`: at most four digits
 * before the point and two after. More is a 400 the grid can't pin to a cell. */
export const MARKS_MAX_INTEGER_DIGITS = 4;
export const MARKS_MAX_DECIMAL_PLACES = 2;

/** `MarksEntrySerializer.remarks`' `max_length`. */
export const MARKS_REMARKS_MAX_LENGTH = 255;

/** The status in which marks are entered; a locked subject in it takes none until unlocked (a
 * send-back returns the exam here with its subjects still locked). */
export const MARKS_ENTRY_EXAM_STATUS: ExamStatus = "marks_entry";

/** camelCase `MarksEntryInput` key -> `MarksEntrySerializer` field. Every key is sent: a null
 * mark or remark clears it. */
export const MARKS_ENTRY_FIELDS: ReadonlyArray<readonly [keyof MarksEntryInput, string]> = [
  ["studentId", "student_id"],
  ["theoryMarks", "theory_marks"],
  ["practicalMarks", "practical_marks"],
  ["isAbsent", "is_absent"],
  ["isExempt", "is_exempt"],
  ["status", "status"],
  ["remarks", "remarks"],
];

/** Mirror `REQUIRED_MARKS_IMPORT_COLUMNS` / `MARKS_IMPORT_COLUMNS`
 * (`apps/api/apps/examinations/services.py`) verbatim: the sheet's exact header names. */
export const MARKS_IMPORT_REQUIRED_COLUMNS = ["admission_number"] as const;
export const MARKS_IMPORT_OPTIONAL_COLUMNS = [
  "theory_marks",
  "practical_marks",
  "is_absent",
  "is_exempt",
  "remarks",
] as const;

/** Per user as well as per tab: a different sign-in never reconnects to someone else's import. */
export const MARKS_IMPORT_JOB_STORAGE_PREFIX = "schoolhub:marks-import-job:";
