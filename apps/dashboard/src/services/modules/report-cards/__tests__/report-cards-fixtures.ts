import type { Page } from "@schoolhub/types";

import type { ReportCardRecord } from "@/services";
import { EXAM_ID, TERM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";
import {
  RESULT_ID,
  RESULT_STUDENT_ID,
  SECTION_ID,
} from "@/services/modules/exam-results/__tests__/exam-results-fixtures";

// UUID-shaped: a filter drops an id that isn't one.
export const REPORT_CARD_ID = "5a6b7c8d-9eaf-40b1-82c3-d4e5f6a7b8c9";
export const OTHER_REPORT_CARD_ID = "6b7c8d9e-afb0-41c2-93d4-e5f6a7b8c9d0";
export const REPORT_CARD_FILE_ID = "7c8d9eaf-b0c1-42d3-a4e5-f6a7b8c9d0e1";

/** Ali Raza's rendered (not yet published) card for section A; override what a test needs. */
export function reportCardRecord(overrides: Partial<ReportCardRecord> = {}): ReportCardRecord {
  return {
    id: REPORT_CARD_ID,
    exam_id: EXAM_ID,
    term_id: TERM_ID,
    student_id: RESULT_STUDENT_ID,
    student_name: "Ali Raza",
    admission_number: "ADM-001",
    result_id: RESULT_ID,
    section_id: SECTION_ID,
    section_name: "A",
    percentage: "82.50",
    grade: "A",
    file_id: REPORT_CARD_FILE_ID,
    class_teacher_remarks: null,
    principal_remarks: null,
    attendance_summary: null,
    version: 1,
    status: "generated",
    published_at: null,
    created_at: "2026-10-25T09:00:00Z",
    updated_at: "2026-10-25T09:00:00Z",
    ...overrides,
  };
}

/** One cursor page of `cards`, the last one unless `nextCursor` says otherwise. */
export function reportCardPage(
  cards: ReportCardRecord[],
  nextCursor: string | null = null,
): Page<ReportCardRecord> {
  return {
    items: cards,
    pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 },
  };
}
