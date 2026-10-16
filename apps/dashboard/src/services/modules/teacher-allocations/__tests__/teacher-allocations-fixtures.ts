import type { Page } from "@schoolhub/types";

import type {
  AllocationSaveResult,
  TeacherAllocationRecord,
  TeacherLoadRow,
  TeacherLoadWarning,
} from "@/services";
import type { StaffDirectoryRecord } from "@/services/modules/staff/staff-type";
import { CLASS_ID, SESSION_ID, SUBJECT_ID } from "@/test-fixtures/academics";

// UUID-shaped, like the shared Academics ids: the URL and the form drop a value that isn't one.
export const ALLOCATION_ID = "8c9d0e1f-2a3b-4c4d-9e5f-6a7b8c9d0e1f";
export const SECTION_ID = "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a";
export const STAFF_ID = "0e1f2a3b-4c5d-4e6f-9a7b-8c9d0e1f2a3b";
export const OTHER_STAFF_ID = "1f2a3b4c-5d6e-4f7a-8b8c-9d0e1f2a3b4c";
export const OTHER_CLASS_ID = "2a3b4c5d-6e7f-4a8b-9c9d-0e1f2a3b4c5d";
export const OTHER_SECTION_ID = "3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e";
export const OTHER_SUBJECT_ID = "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f";

/** A current, primary Mathematics allocation of Ayesha Khan to Grade 1 · A, with no override
 * and no start date; override what a test needs. */
export function allocationRecord(
  overrides: Partial<TeacherAllocationRecord> = {},
): TeacherAllocationRecord {
  return {
    id: ALLOCATION_ID,
    academic_session_id: SESSION_ID,
    section_id: SECTION_ID,
    subject_id: SUBJECT_ID,
    staff_id: STAFF_ID,
    is_primary: true,
    weekly_periods: null,
    effective_from: null,
    effective_to: null,
    class_id: CLASS_ID,
    class_name: "Grade 1",
    section_name: "A",
    subject_name: "Mathematics",
    staff_name: "Ayesha Khan",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

/** One page of the list, as the API answers it (page size 10, the table's default). */
export function allocationPage(
  items: TeacherAllocationRecord[],
  { page = 1, totalPages = 1 }: { page?: number; totalPages?: number } = {},
): Page<TeacherAllocationRecord> {
  return {
    items,
    pagination: { page, page_size: 10, total_count: items.length, total_pages: totalPages },
  };
}

/** A teacher within a norm of 30 periods; override what a test needs. */
export function loadRow(overrides: Partial<TeacherLoadRow> = {}): TeacherLoadRow {
  return {
    staff_id: STAFF_ID,
    name: "Ayesha Khan",
    weekly_periods: 18,
    allocations: 4,
    norm: 30,
    over_norm: false,
    ...overrides,
  };
}

/** The advisory warning the server adds when a save leaves a teacher over the norm. */
export function overNormWarning(overrides: Partial<TeacherLoadWarning> = {}): TeacherLoadWarning {
  return {
    code: "teacher_over_norm",
    staff_id: STAFF_ID,
    weekly_periods: 34,
    norm: 30,
    ...overrides,
  };
}

/** What a save resolves with: the allocation, and any warnings that came with it. */
export function savedAllocation(
  warnings: TeacherLoadWarning[] = [],
  overrides: Partial<TeacherAllocationRecord> = {},
): AllocationSaveResult {
  return { allocation: allocationRecord(overrides), warnings };
}

/** An active teacher, as `Services.staff.fetchTeachingStaffOptions` returns one. */
export function teacherRecord(overrides: Partial<StaffDirectoryRecord> = {}): StaffDirectoryRecord {
  return {
    id: STAFF_ID,
    first_name: "Ayesha",
    last_name: "Khan",
    designation_name: null,
    department_name: null,
    campus_name: "Main Campus",
    staff_type: "teaching",
    employment_status: "active",
    updated_at: "2026-08-01T00:00:00Z",
    photo_url: null,
    ...overrides,
  };
}
