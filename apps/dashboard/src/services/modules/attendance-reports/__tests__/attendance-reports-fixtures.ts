import type { ReportRowOf } from "../attendance-reports-type";

/**
 * Report rows in the exact shapes `GET /reports/attendance-summary` sends (the typed row
 * serializers, `apps/api/apps/attendance/serializers.py`): every row carries its `kind`, and
 * `attendance_rate` and `days_count` are JSON numbers.
 */

export const STUDENT_ID = "11111111-aaaa-4bbb-8ccc-000000000001";
export const OTHER_STUDENT_ID = "11111111-aaaa-4bbb-8ccc-000000000002";
export const STAFF_ID = "22222222-aaaa-4bbb-8ccc-000000000001";
export const SECTION_ID = "33333333-aaaa-4bbb-8ccc-000000000001";
export const PERIOD_ID = "44444444-aaaa-4bbb-8ccc-000000000001";
export const ROW_ID = "55555555-aaaa-4bbb-8ccc-000000000001";
export const LEAVE_ID = "66666666-aaaa-4bbb-8ccc-000000000001";
export const JOB_ID = "77777777-aaaa-4bbb-8ccc-000000000001";
export const FILE_ID = "88888888-aaaa-4bbb-8ccc-000000000001";

const student = {
  student_id: STUDENT_ID,
  first_name: "Ayesha",
  last_name: "Khan",
  admission_number: "ADM-001",
};

export function dailyRegisterRow(
  overrides: Partial<ReportRowOf<"daily-register">> = {},
): ReportRowOf<"daily-register"> {
  return {
    ...student,
    kind: "daily-register",
    id: ROW_ID,
    status: "late",
    check_in_time: "08:40:00",
    late_minutes: 40,
    remarks: "Bus delayed",
    section_name: "7-A",
    period_name: null,
    ...overrides,
  };
}

export function summaryRow(
  overrides: Partial<ReportRowOf<"student-summary">> = {},
): ReportRowOf<"student-summary"> {
  return {
    ...student,
    kind: "student-summary",
    present_days: 8,
    counted_days: 10,
    absent_days: 2,
    late_days: 1,
    leave_days: 0,
    attendance_rate: 80,
    ...overrides,
  };
}

export function defaulterRow(
  overrides: Partial<ReportRowOf<"defaulters">> = {},
): ReportRowOf<"defaulters"> {
  return {
    ...student,
    kind: "defaulters",
    present_days: 4,
    counted_days: 10,
    absent_days: 6,
    late_days: 0,
    leave_days: 1,
    attendance_rate: 40,
    ...overrides,
  };
}

export function lateArrivalsRow(
  overrides: Partial<ReportRowOf<"student-late-arrivals">> = {},
): ReportRowOf<"student-late-arrivals"> {
  return {
    ...student,
    kind: "student-late-arrivals",
    late_count: 3,
    total_late_minutes: 50,
    average_late_minutes: 16.666666666666668,
    ...overrides,
  };
}

export function staffPunctualityRow(
  overrides: Partial<ReportRowOf<"staff-punctuality">> = {},
): ReportRowOf<"staff-punctuality"> {
  return {
    kind: "staff-punctuality",
    staff_id: STAFF_ID,
    first_name: "Omar",
    last_name: "Farooq",
    employee_number: "EMP-002",
    working_days: 20,
    present_days: 18,
    absent_days: 1,
    leave_days: 1,
    late_count: 2,
    total_late_minutes: 25,
    total_early_departure_minutes: null,
    ...overrides,
  };
}

export function leaveRow(overrides: Partial<ReportRowOf<"leave">> = {}): ReportRowOf<"leave"> {
  return {
    kind: "leave",
    id: LEAVE_ID,
    status: "approved",
    start_date: "2026-10-12",
    end_date: "2026-10-13",
    days_count: 1.5,
    day_part: "full",
    student_id: STUDENT_ID,
    first_name: "Ayesha",
    last_name: "Khan",
    leave_type_name: "Sick leave",
    ...overrides,
  };
}

/** The `202` body a too-large inline run (or any export) answers with (`ActionResponse.accepted`). */
export const ACCEPTED = { job_id: JOB_ID, status: "queued" } as const;
