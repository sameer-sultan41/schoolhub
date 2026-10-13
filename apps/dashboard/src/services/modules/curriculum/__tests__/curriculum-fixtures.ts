import type { Page } from "@schoolhub/types";

import type { AcademicSessionSummary, CurriculumRecord } from "@/services";

// Every id is UUID-shaped: the URL and the form both drop a value that isn't one.
export const SESSION_ID = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
export const PLANNED_SESSION_ID = "1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e";
export const CLOSED_SESSION_ID = "2c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f";
export const UNKNOWN_SESSION_ID = "3d4e5f6a-7b8c-4d9e-9f0a-1b2c3d4e5f6a";
export const CLASS_ID = "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b";
export const SUBJECT_ID = "5f6a7b8c-9d0e-4f1a-9b2c-3d4e5f6a7b8c";
export const CAMPUS_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
export const RECORD_ID = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";

export const CURRENT_SESSION: AcademicSessionSummary = {
  id: SESSION_ID,
  name: "2026-27",
  status: "active",
  is_current: true,
};
export const PLANNED_SESSION: AcademicSessionSummary = {
  id: PLANNED_SESSION_ID,
  name: "2027-28",
  status: "planned",
  is_current: false,
};
export const CLOSED_SESSION: AcademicSessionSummary = {
  id: CLOSED_SESSION_ID,
  name: "2025-26",
  status: "closed",
  is_current: false,
};
export const SESSIONS = [CURRENT_SESSION, PLANNED_SESSION, CLOSED_SESSION];

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
