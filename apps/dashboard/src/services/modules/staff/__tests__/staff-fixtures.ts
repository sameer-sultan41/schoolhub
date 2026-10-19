import type { StaffDirectoryRecord } from "../staff-type";

/** Ayesha Khan, an active teacher; override what a test needs. */
export function staffDirectoryRecord(
  overrides: Partial<StaffDirectoryRecord> = {},
): StaffDirectoryRecord {
  return {
    id: "st-1",
    first_name: "Ayesha",
    last_name: "Khan",
    designation_name: "Head Teacher",
    department_name: "Academics",
    campus_name: "Main Campus",
    staff_type: "teaching",
    employment_status: "active",
    updated_at: "2026-09-01T00:00:00Z",
    photo_url: null,
    ...overrides,
  };
}
