import type { AttendanceSettings } from "@/services";

/** The server's own refusal of `period` while `module.timetable` is off
 * (`attendance.services.TIMETABLE_REQUIRED`), which arrives on the `attendance_mode` field. */
export const TIMETABLE_REQUIRED_MESSAGE =
  "Period attendance needs the timetable module; turn it on first.";

/** Typical values: daily, a 2-day lock window, escalation past 10 days of leave (§19's
 * threshold default; the lock window's own default is 0). */
export function attendanceSettings(
  overrides: Partial<AttendanceSettings> = {},
): AttendanceSettings {
  return {
    attendance_mode: "daily",
    lock_window_days: 2,
    leave_escalation_threshold_days: 10,
    ...overrides,
  };
}
