import { ApiError } from "@schoolhub/api-client";

import type {
  MarksGrid,
  MarksGridEntry,
  MarksGridMeta,
  MarksProgressRow,
  MarksRecord,
  MarksUnwritableReason,
} from "@/services";
import { EXAM_SUBJECT_ID } from "@/services/modules/exam-subjects/__tests__/exam-subjects-fixtures";
import {
  OTHER_SECTION_ID,
  SECTION_ID,
} from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";

export { EXAM_SUBJECT_ID, OTHER_SECTION_ID, SECTION_ID };

// UUID-shaped: the tab drops a `subject` or `section` that isn't one.
export const STUDENT_ID = "a1b2c3d4-e5f6-4a07-8b18-293a4b5c6d7e";
export const OTHER_STUDENT_ID = "b2c3d4e5-f6a7-4b18-9c29-3a4b5c6d7e8f";
export const MARKS_ID = "c3d4e5f6-a7b8-4c29-8d3a-4b5c6d7e8f90";
/** English in Grade 5: a second exam-subject, locked as a whole. */
export const OTHER_EXAM_SUBJECT_ID = "e5f6a7b8-c9d0-4e4b-8f5c-6d7e8f901234";

/** `bulk_enter_marks`' sentences (`apps/api/apps/examinations/services.py`). */
export const NOT_ON_ROLL_ISSUE =
  "This student is not on this section's roll for the exam's session.";
export const ABOVE_MAX_ISSUE = "120.00 is above this subject's maximum of 100.00.";
/** `marks_grid_writability`'s and its gates' sentences, one per `unwritable_reason`. */
export const UNWRITABLE_MESSAGES: Record<MarksUnwritableReason, string> = {
  no_permission: "You can read these marks but not enter them.",
  exam_status:
    "This exam is approved, so its marks are closed. Send the results back for correction to reopen entry.",
  locked:
    "Marks for this subject are locked. They can only be changed after an unlock, which is audited.",
  window_not_open: "Marks entry for this subject opens 2026-11-10 08:00.",
  window_closed:
    "Marks entry for this subject closed 2026-11-01 17:00. Ask for the window to be reopened.",
};

/** Ali Raza's saved draft: 45.5 of 100. */
export function marksRecord(overrides: Partial<MarksRecord> = {}): MarksRecord {
  return {
    id: MARKS_ID,
    exam_subject_id: EXAM_SUBJECT_ID,
    student_id: STUDENT_ID,
    theory_marks: "45.50",
    practical_marks: null,
    is_absent: false,
    is_exempt: false,
    status: "draft",
    remarks: null,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  };
}

export function gridEntry(overrides: Partial<MarksGridEntry> = {}): MarksGridEntry {
  return {
    student_id: STUDENT_ID,
    student_name: "Ali Raza",
    admission_number: "ADM-001",
    roll_number: "1",
    marks: marksRecord(),
    ...overrides,
  };
}

/** Sara Khan, roll 2, nothing entered yet. */
export const SARA = gridEntry({
  student_id: OTHER_STUDENT_ID,
  student_name: "Sara Khan",
  admission_number: "ADM-002",
  roll_number: "2",
  marks: null,
});

export function gridMeta(overrides: Partial<MarksGridMeta> = {}): MarksGridMeta {
  return {
    examSubject: {
      maxMarks: "100.00",
      passMarks: "40.00",
      hasPractical: false,
      practicalMaxMarks: null,
    },
    writable: true,
    unwritableReason: null,
    unwritableMessage: null,
    ...overrides,
  };
}

/** A read-only grid for `reason`, with the server's sentence. */
export function unwritableMeta(reason: MarksUnwritableReason): MarksGridMeta {
  return gridMeta({
    writable: false,
    unwritableReason: reason,
    unwritableMessage: UNWRITABLE_MESSAGES[reason],
  });
}

export function marksGrid(
  entries: MarksGridEntry[] = [gridEntry(), SARA],
  meta: MarksGridMeta = gridMeta(),
): MarksGrid {
  return { entries, meta };
}

/** Mathematics, Grade 5-A: 1 of 2 entered, none submitted. */
export function progressRow(overrides: Partial<MarksProgressRow> = {}): MarksProgressRow {
  return {
    exam_subject_id: EXAM_SUBJECT_ID,
    subject_name: "Mathematics",
    class_name: "Grade 5",
    section_id: SECTION_ID,
    section_name: "A",
    expected: 2,
    entered: 1,
    submitted: 0,
    is_locked: false,
    ...overrides,
  };
}

/**
 * `bulk_enter_marks`' refusal: a `DomainRuleViolation` (422) whose string detail flattens to one
 * `non_field` detail, with each refused row in `meta.rows` as `{index, student_id, field, issue}`.
 */
export function refusedBulkEntry(
  rows: { index: number; student_id: string; field: string; issue: string }[],
  total: number,
): ApiError {
  const counted = `${String(rows.length)} of ${String(total)}`;
  const message = `${counted} rows were rejected; nothing was saved.`;
  return new ApiError({
    code: "domain_rule_violation",
    message,
    status: 422,
    url: "/marks:bulk-entry",
    details: [{ field: "non_field", issue: message }],
    meta: { rows },
  });
}
