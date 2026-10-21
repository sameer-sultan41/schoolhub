import type { Page } from "@schoolhub/types";

import type { TeacherSubstitutionRecord } from "@/services";

// UUID-shaped: the URL and the forms drop an id that isn't one.
export const SUBSTITUTION_ID = "c4d5e6f7-a8b9-4c0d-8e1f-2a3b4c5d6e7f";
export const PROPOSER_ID = "d5e6f7a8-b9c0-4d1e-9f2a-3b4c5d6e7f8a";

/** Bilal Khan covering Amna Raza's Monday Period 1 with Grade 5-A, proposed; override what a
 * test needs. */
export function substitutionRecord(
  overrides: Partial<TeacherSubstitutionRecord> = {},
): TeacherSubstitutionRecord {
  return {
    id: SUBSTITUTION_ID,
    timetable_slot_id: "e6f7a8b9-c0d1-4e2f-8a3b-4c5d6e7f8a9b",
    date: "2099-01-05",
    day_of_week: 0,
    section_name: "Grade 5-A",
    subject_name: "Mathematics",
    period_name: "Period 1",
    absent_staff_id: "f7a8b9c0-d1e2-4f3a-9b4c-5d6e7f8a9b0c",
    absent_staff_name: "Amna Raza",
    substitute_staff_id: "a8b9c0d1-e2f3-4a4b-8c5d-6e7f8a9b0c1d",
    substitute_staff_name: "Bilal Khan",
    slot_room_name: "Room 101",
    room_id: null,
    room_name: null,
    reason: null,
    leave_request_id: null,
    status: "proposed",
    created_by: PROPOSER_ID,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

export function substitutionPage(
  items: TeacherSubstitutionRecord[],
): Page<TeacherSubstitutionRecord> {
  return {
    items,
    pagination: { page: 1, page_size: 10, total_count: items.length, total_pages: 1 },
  };
}
