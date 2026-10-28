import { ApiError } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";

import type { StaffAttendanceRecord, StaffRegisterEntry } from "@/services";

// UUID-shaped, like every id the server sends.
export const STAFF_ID = "66666666-aaaa-4bbb-8ccc-000000000001";
export const OTHER_STAFF_ID = "66666666-aaaa-4bbb-8ccc-000000000002";
export const THIRD_STAFF_ID = "66666666-aaaa-4bbb-8ccc-000000000003";
export const STAFF_ROW_ID = "88888888-aaaa-4bbb-8ccc-000000000001";
export const OTHER_STAFF_ROW_ID = "88888888-aaaa-4bbb-8ccc-000000000002";
export const DEPARTMENT_ID = "55555555-aaaa-4bbb-8ccc-000000000009";
export const MARKER_ID = "44444444-aaaa-4bbb-8ccc-000000000001";

/** The sentences `services.mark_staff_attendance` and `check_out_staff` raise. */
export const LOCKED_MARK =
  "This record is locked and must be changed through a correction request.";
export const LOCKED_CHECK_OUT = "This record is locked and must be changed through a correction.";
export const CHECK_OUT_NOT_AFTER = "Check-out must be later than check-in (§11).";
/** `assert_markable_date`'s holiday sentence for 2026-10-23, on `attendance_date`. */
export const HOLIDAY_REFUSAL = "2026-10-23 is Founders Day; the school is closed.";

/** Nadia Hussain present on 2026-10-23, in at 08:00 and not yet checked out; override what a
 * test needs. */
export function staffRecord(overrides: Partial<StaffAttendanceRecord> = {}): StaffAttendanceRecord {
  return {
    id: STAFF_ROW_ID,
    staff_id: STAFF_ID,
    staff_name: "Nadia Hussain",
    employee_number: "EMP-001",
    attendance_date: "2026-10-23",
    status: "present",
    check_in_time: "08:00:00",
    check_out_time: null,
    late_minutes: null,
    early_departure_minutes: null,
    leave_request_id: null,
    source: "manual",
    marked_by: MARKER_ID,
    is_locked: false,
    remarks: null,
    created_at: "2026-10-23T08:00:00Z",
    updated_at: "2026-10-23T08:00:00Z",
    ...overrides,
  };
}

/** A register row for Nadia with no record yet; override what a test needs. */
export function staffRegisterEntry(
  overrides: Partial<StaffRegisterEntry> = {},
): StaffRegisterEntry {
  return {
    staff_id: STAFF_ID,
    staff_name: "Nadia Hussain",
    employee_number: "EMP-001",
    department_name: "Science",
    record: null,
    on_leave: false,
    ...overrides,
  };
}

/** One cursor page of staff records, as `fetchStaffAttendancePage` returns it. */
export function staffAttendancePage(
  items: StaffAttendanceRecord[],
  cursors: { next?: string | null; previous?: string | null } = {},
): Page<StaffAttendanceRecord> {
  return {
    items,
    pagination: {
      next_cursor: cursors.next ?? null,
      previous_cursor: cursors.previous ?? null,
      page_size: 25,
    },
  };
}

/** A 409 as the envelope carries a `Conflict`: its sentence as the message and as the one
 * `non_field` detail. */
export function lockedConflict(message: string, url: string): ApiError {
  return new ApiError({
    code: "conflict",
    message,
    status: 409,
    url,
    details: [{ field: "non_field", issue: message }],
  });
}

/** A 422 refusal on one field, as `DomainRuleViolation` sends it. */
export function domainRefusal(field: string, issue: string, url: string): ApiError {
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url,
    details: [{ field, issue }],
  });
}
