import type { TimetableConflict, TimetableSlotRecord } from "@/services";
import { SESSION_ID } from "@/test-fixtures/academics";

// UUID-shaped: the URL and the forms drop an id that isn't one.
export const SECTION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
export const PERIOD_1_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
export const PERIOD_2_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
export const SUBJECT_ID = "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a";
export const TEACHER_ID = "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8a9b";
export const OTHER_TEACHER_ID = "f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8a9b0c";
export const ROOM_ID = "a7b8c9d0-e1f2-4a3b-8c5d-6e7f8a9b0c1d";

let counter = 0;

/** A Monday, Period 1 draft of Mathematics with Amna Raza in R-101; override what a test needs. */
export function slotRecord(overrides: Partial<TimetableSlotRecord> = {}): TimetableSlotRecord {
  counter += 1;
  return {
    id: `0${counter.toString(16).padStart(7, "0")}-0000-4000-8000-000000000000`,
    academic_session_id: SESSION_ID,
    section_id: SECTION_ID,
    section_name: "A",
    day_of_week: 0,
    period_id: PERIOD_1_ID,
    period_name: "Period 1",
    period_sequence: 1,
    start_time: "08:00:00",
    end_time: "08:45:00",
    subject_id: SUBJECT_ID,
    subject_name: "Mathematics",
    staff_id: TEACHER_ID,
    staff_name: "Amna Raza",
    room_id: ROOM_ID,
    room_name: "Room 101",
    status: "draft",
    effective_from: null,
    effective_to: null,
    notes: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

export function conflict(overrides: Partial<TimetableConflict> = {}): TimetableConflict {
  return {
    type: "teacher_double_booked",
    severity: "hard",
    slot_ids: [],
    // `slots/conflicts.py`'s own wording for this type.
    message: "This teacher is already teaching in this period.",
    ...overrides,
  };
}
