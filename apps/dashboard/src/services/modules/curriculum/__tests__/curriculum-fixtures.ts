import type { Page } from "@schoolhub/types";

import type { CurriculumRecord } from "@/services";
import { CAMPUS_ID, CLASS_ID, SESSION_ID, SUBJECT_ID } from "@/test-fixtures/academics";

// UUID-shaped, like the shared Academics ids: the URL and the form drop a value that isn't one.
export const RECORD_ID = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";

/** A core Mathematics mapping for Grade 1 on the main campus; override what a test needs. */
export function curriculumRecord(overrides: Partial<CurriculumRecord> = {}): CurriculumRecord {
  return {
    id: RECORD_ID,
    academic_session_id: SESSION_ID,
    academic_session_name: "2026-27",
    class_id: CLASS_ID,
    class_name: "Grade 1",
    subject_id: SUBJECT_ID,
    subject_name: "Mathematics",
    campus_id: CAMPUS_ID,
    campus_name: "Main Campus",
    is_elective: false,
    elective_group: null,
    weekly_periods: 5,
    syllabus_file_id: null,
    term_plans: null,
    notes: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

/** One page of the list, as the API answers it (page size 10, the table's default). */
export function curriculumPage(
  items: CurriculumRecord[],
  { page = 1, totalPages = 1 }: { page?: number; totalPages?: number } = {},
): Page<CurriculumRecord> {
  return {
    items,
    pagination: { page, page_size: 10, total_count: items.length, total_pages: totalPages },
  };
}
