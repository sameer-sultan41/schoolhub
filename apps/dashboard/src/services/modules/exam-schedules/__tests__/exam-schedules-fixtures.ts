import type { ExamConflict, SittingRecord } from "@/services";
import { EXAM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";
import { EXAM_SUBJECT_ID } from "@/services/modules/exam-subjects/__tests__/exam-subjects-fixtures";
import { CAMPUS_ID } from "@/test-fixtures/academics";

export { CAMPUS_ID, EXAM_SUBJECT_ID };

// UUID-shaped: the form drops an id that isn't one.
export const SITTING_ID = "13b4c5d6-e7f8-49a0-b415-9a0112233445";
export const OTHER_SITTING_ID = "24c5d6e7-f8a9-4ab1-8526-ab1223344556";
export const SECTION_ID = "35d6e7f8-a9b0-4bc2-9637-bc2334455667";
export const OTHER_SECTION_ID = "46e7f8a9-b0c1-4cd3-a748-cd3445566778";
export const STAFF_ID = "57f8a9b0-c1d2-4de4-b859-de4556677889";

/** Mathematics for Grade 5 A on 5 October, 09:00 to 11:00, in Room 101 with Ayesha Khan. */
export function sittingRecord(overrides: Partial<SittingRecord> = {}): SittingRecord {
  return {
    id: SITTING_ID,
    exam_id: EXAM_ID,
    exam_name: "Term 1 Midterm",
    exam_subject_id: EXAM_SUBJECT_ID,
    subject_name: "Mathematics",
    class_name: "Grade 5",
    section_id: SECTION_ID,
    section_name: "A",
    exam_date: "2026-10-05",
    start_time: "09:00:00",
    end_time: "11:00:00",
    room_id: "9d0e1f2a-3b4c-4d5e-9f6a-7b8c9d0e1f2a",
    room_name: "Room 101",
    invigilator_staff_id: STAFF_ID,
    invigilator_name: "Ayesha Khan",
    status: "scheduled",
    instructions: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

/** A hard room clash naming the first sitting; override what a test needs. */
export function conflictRecord(overrides: Partial<ExamConflict> = {}): ExamConflict {
  return {
    type: "room_double_booked",
    severity: "hard",
    schedule_ids: [SITTING_ID],
    message: "Room 101 is booked for two sittings at 09:00.",
    ...overrides,
  };
}
