import type { Page } from "@schoolhub/types";

import type { AttendanceCorrectionRecord } from "@/services";
import { STUDENT_ID } from "@/services/modules/student-attendance/__tests__/student-attendance-fixtures";

// UUID-shaped, like every id the server sends.
export const CORRECTION_ID = "99999999-aaaa-4bbb-8ccc-000000000001";
export const OTHER_CORRECTION_ID = "99999999-aaaa-4bbb-8ccc-000000000002";
export const THIRD_CORRECTION_ID = "99999999-aaaa-4bbb-8ccc-000000000003";
export const ATTENDANCE_ID = "33333333-aaaa-4bbb-8ccc-000000000001";
export const REQUESTER_ID = "77777777-aaaa-4bbb-8ccc-000000000001";

/** The sentences `services.decide_correction` raises, as the envelope carries them. */
export const ALREADY_APPROVED = "This correction was already approved.";
export const OWN_REQUEST = "An approver cannot decide their own correction request (§11).";
export const OWN_ATTENDANCE =
  "An approver cannot decide a correction to their own attendance (§11).";

/** A pending request from another user: Amna's late arrival becomes present, with a note. */
export function correctionRecord(
  overrides: Partial<AttendanceCorrectionRecord> = {},
): AttendanceCorrectionRecord {
  return {
    id: CORRECTION_ID,
    subject_type: "student",
    student_attendance_id: ATTENDANCE_ID,
    student_id: STUDENT_ID,
    student_name: "Amna Raza",
    staff_attendance_id: null,
    staff_name: null,
    employee_number: null,
    subject_user_id: null,
    attendance_date: "2026-10-10",
    period_name: null,
    requested_by: REQUESTER_ID,
    requested_by_name: "Imran Siddiqui",
    old_values: { status: "late", check_in_time: "08:20:00", remarks: null },
    // `check_in_time` is named but unchanged, as a partial proposal may be.
    new_values: { status: "present", check_in_time: "08:20:00", remarks: "Gate log" },
    reason: "Gate log shows on time",
    status: "pending",
    reviewed_by: null,
    reviewed_by_name: null,
    reviewed_at: null,
    review_note: null,
    created_at: "2026-10-12T09:00:00Z",
    updated_at: "2026-10-12T09:00:00Z",
    ...overrides,
  };
}

/** One cursor page of corrections, as `fetchCorrectionPage` returns it. */
export function correctionPage(
  items: AttendanceCorrectionRecord[],
  cursors: { next?: string | null; previous?: string | null } = {},
): Page<AttendanceCorrectionRecord> {
  return {
    items,
    pagination: {
      next_cursor: cursors.next ?? null,
      previous_cursor: cursors.previous ?? null,
      page_size: 25,
    },
  };
}
