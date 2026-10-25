import { ApiError } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";

import type { MyRegister, RegisterEntry, StudentAttendanceRecord } from "@/services";

// UUID-shaped: the URL and the forms drop an id that isn't one.
export const SECTION_ID = "11111111-aaaa-4bbb-8ccc-000000000001";
export const SESSION_ID = "11111111-aaaa-4bbb-8ccc-000000000002";
export const PERIOD_ID = "11111111-aaaa-4bbb-8ccc-000000000003";
export const STUDENT_ID = "22222222-aaaa-4bbb-8ccc-000000000001";
export const OTHER_STUDENT_ID = "22222222-aaaa-4bbb-8ccc-000000000002";
export const THIRD_STUDENT_ID = "22222222-aaaa-4bbb-8ccc-000000000003";

/** The sentences `services.bulk_mark_student_attendance` puts in `error.meta.rows[].issue`. */
export const ISSUE_NOT_ENROLLED = "Not actively enrolled in this section for this session.";
export const ISSUE_DUPLICATE = "Listed more than once in this register.";
export const ISSUE_SYSTEM_ONLY =
  "'on_leave' is written by an approved leave request, not marked at the register.";
export const ISSUE_ON_LEAVE =
  "This student has approved leave on this date; cancel the leave request before marking them.";

/** A marked row: Amna Raza present in Grade 5-A; override what a test needs. */
export function attendanceRecord(
  overrides: Partial<StudentAttendanceRecord> = {},
): StudentAttendanceRecord {
  return {
    id: "33333333-aaaa-4bbb-8ccc-000000000001",
    student_id: STUDENT_ID,
    student_name: "Amna Raza",
    admission_number: "ADM-001",
    section_id: SECTION_ID,
    section_name: "Grade 5-A",
    academic_session_id: SESSION_ID,
    period_id: null,
    period_name: null,
    attendance_date: "2026-10-23",
    status: "present",
    check_in_time: null,
    check_out_time: null,
    late_minutes: null,
    leave_request_id: null,
    source: "manual",
    marked_by: "44444444-aaaa-4bbb-8ccc-000000000001",
    is_locked: false,
    remarks: null,
    created_at: "2026-10-23T08:00:00Z",
    updated_at: "2026-10-23T08:00:00Z",
    ...overrides,
  };
}

/** One cursor page of records, as `fetchAttendancePage` returns it. */
export function attendancePage(
  items: StudentAttendanceRecord[],
  cursors: { next?: string | null; previous?: string | null } = {},
): Page<StudentAttendanceRecord> {
  return {
    items,
    pagination: {
      next_cursor: cursors.next ?? null,
      previous_cursor: cursors.previous ?? null,
      page_size: 25,
    },
  };
}

/** A roster row with no record yet; override what a test needs. */
export function registerEntry(overrides: Partial<RegisterEntry> = {}): RegisterEntry {
  return {
    student_id: STUDENT_ID,
    student_name: "Amna Raza",
    admission_number: "ADM-001",
    roll_number: "1",
    record: null,
    on_leave: false,
    ...overrides,
  };
}

/** A daily-mode register for a section; override what a test needs. */
export function myRegister(overrides: Partial<MyRegister> = {}): MyRegister {
  return {
    section_id: SECTION_ID,
    section_name: "A",
    class_name: "Grade 5",
    campus_id: "55555555-aaaa-4bbb-8ccc-000000000001",
    period_id: null,
    period_name: null,
    start_time: null,
    end_time: null,
    marked_count: 0,
    roster_count: 30,
    ...overrides,
  };
}

/** `register_meta`'s keys, as the server sends them in `meta`. */
export function registerMetaWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attendance_mode: "daily",
    is_locked: false,
    markable: true,
    unmarkable_reason: null,
    holiday_name: null,
    academic_session_id: SESSION_ID,
    ...overrides,
  };
}

/** The `entries` sentence of the first refusal: duplicate, not-enrolled and system-only rows. */
export const REFUSED_MESSAGE = "Some rows could not be marked; the register was not saved.";
/** The `entries` sentence of the on-leave refusal, raised only once the first check passes. */
export const ON_LEAVE_REFUSED_MESSAGE =
  "Some students are on approved leave; the register was not saved.";

function refusal(message: string, rows: unknown): ApiError {
  return new ApiError({
    code: "domain_rule_violation",
    message,
    status: 422,
    url: "/student-attendance:bulk-mark",
    details: [{ field: "entries", issue: message }],
    meta: { rows },
  });
}

/**
 * The first refusal of `bulk_mark_student_attendance`: 422, its `entries` detail, and the rows
 * under `meta`. Its rows carry only `ISSUE_DUPLICATE`, `ISSUE_NOT_ENROLLED` or
 * `ISSUE_SYSTEM_ONLY`; an on-leave row is `onLeaveBulkMark`'s, a separate, later refusal.
 */
export function refusedBulkMark(rows: unknown): ApiError {
  return refusal(REFUSED_MESSAGE, rows);
}

/** The on-leave refusal: every named student gets `ISSUE_ON_LEAVE`, with its own sentence. */
export function onLeaveBulkMark(studentIds: readonly string[]): ApiError {
  return refusal(
    ON_LEAVE_REFUSED_MESSAGE,
    studentIds.map((studentId) => ({ student_id: studentId, issue: ISSUE_ON_LEAVE })),
  );
}
