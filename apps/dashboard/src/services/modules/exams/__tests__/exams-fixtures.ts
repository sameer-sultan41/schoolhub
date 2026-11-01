import type { Page } from "@schoolhub/types";

import type { ExamRecord } from "@/services";
import { SESSION_ID } from "@/test-fixtures/academics";

export { SESSION_ID };

// UUID-shaped: the URL and the form drop an id that isn't one.
export const EXAM_ID = "7f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
export const OTHER_EXAM_ID = "8a2b3c4d-5e6f-4071-9b8c-0d1e2f3a4b5c";
export const TERM_ID = "ac4d5e6f-7081-4293-9dae-2f3a4b5c6d7e";
export const SCALE_ID = "bd5e6f70-8192-43a4-aebf-3a4b5c6d7e8f";

/** A draft midterm in the current session, with two subjects. */
export function examRecord(overrides: Partial<ExamRecord> = {}): ExamRecord {
  return {
    id: EXAM_ID,
    academic_session_id: SESSION_ID,
    academic_session_name: "2026-27",
    term_id: TERM_ID,
    term_name: "Term 1",
    name: "Term 1 Midterm",
    exam_type: "midterm",
    grading_scale_id: SCALE_ID,
    grading_scale_name: "Standard letters",
    weightage_percent: "40.00",
    starts_on: "2026-10-05",
    ends_on: "2026-10-12",
    status: "draft",
    subject_count: 2,
    description: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

export function examPage(items: ExamRecord[]): Page<ExamRecord> {
  return {
    items,
    pagination: { page: 1, page_size: 10, total_count: items.length, total_pages: 1 },
  };
}
