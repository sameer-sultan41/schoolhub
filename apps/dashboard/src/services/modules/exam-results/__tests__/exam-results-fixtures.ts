import type { Page } from "@schoolhub/types";

import type { ResultRecord } from "@/services";
import { EXAM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";
import {
  OTHER_SECTION_ID,
  SECTION_ID,
} from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";

export { OTHER_SECTION_ID, SECTION_ID };

// UUID-shaped: a filter drops an id that isn't one.
export const RESULT_ID = "1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5";
export const OTHER_RESULT_ID = "2d3e4f5a-6b7c-4d8e-9fa0-b1c2d3e4f5a6";
export const RESULT_STUDENT_ID = "3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7";
/** `buildUser`'s id: the signed-in test user. */
export const CURRENT_USER_ID = "user-1";
export const OTHER_USER_ID = "4f5a6b7c-8d9e-4fa0-b1c2-d3e4f5a6b7c8";

/** Ali Raza's result in section A, processed by another user and awaiting approval. */
export function resultRecord(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    id: RESULT_ID,
    exam_id: EXAM_ID,
    exam_name: "Mid-term",
    term_name: "Term 1",
    student_id: RESULT_STUDENT_ID,
    student_name: "Ali Raza",
    admission_number: "ADM-001",
    section_id: SECTION_ID,
    section_name: "A",
    total_max_marks: "500.00",
    total_obtained_marks: "412.50",
    percentage: "82.50",
    grade: "A",
    gpa: "3.70",
    rank_in_section: 1,
    rank_in_class: 2,
    outcome: "pass",
    grace_marks: "0.00",
    status: "pending_approval",
    processed_by: OTHER_USER_ID,
    processed_by_name: "Hina Clerk",
    approved_by: null,
    approved_by_name: null,
    approved_at: null,
    published_at: null,
    created_at: "2026-10-20T09:00:00Z",
    updated_at: "2026-10-20T09:00:00Z",
    ...overrides,
  };
}

/** One cursor page of `results`, the last one unless `nextCursor` says otherwise. */
export function resultPage(
  results: ResultRecord[],
  nextCursor: string | null = null,
): Page<ResultRecord> {
  return {
    items: results,
    pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 },
  };
}
