import { copyMappedFields } from "@/lib/helpers";
import { ATTENDANCE_SETTINGS_BODY_FIELDS } from "./attendance-settings-constant";
import type { AttendanceSettingsFormValues } from "./attendance-settings.schema";
import type { AttendanceSettings, AttendanceSettingsInput } from "./attendance-settings-type";

/** The attendance settings' pure helpers: plain data in, plain data out. */

const WHOLE_NUMBER = /^\d+$/;

/** Whether `value` is a whole number (digits only, no sign or decimals) from `min` to `max`. */
export function isWholeNumberInRange(value: string, min: number, max: number): boolean {
  const trimmed = value.trim();
  if (!WHOLE_NUMBER.test(trimmed)) return false;
  const number = Number(trimmed);
  return number >= min && number <= max;
}

export function toSettingsBody(input: AttendanceSettingsInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  copyMappedFields(input, ATTENDANCE_SETTINGS_BODY_FIELDS, (value) => value !== undefined, body);
  return body;
}

export function settingsToFormValues(settings: AttendanceSettings): AttendanceSettingsFormValues {
  return {
    attendance_mode: settings.attendance_mode,
    lock_window_days: String(settings.lock_window_days),
    leave_escalation_threshold_days: String(settings.leave_escalation_threshold_days),
  };
}

/**
 * The form -> only the settings that differ from `current`. An unchanged mode is never sent:
 * the API refuses `period` while the timetable is off even when it is already the mode, which
 * would block an unrelated save of the lock window.
 */
export function buildSettingsChanges(
  values: AttendanceSettingsFormValues,
  current: AttendanceSettings,
): AttendanceSettingsInput {
  const changes: AttendanceSettingsInput = {};
  const lockWindowDays = Number(values.lock_window_days.trim());
  const threshold = Number(values.leave_escalation_threshold_days.trim());
  if (values.attendance_mode !== current.attendance_mode) {
    changes.attendanceMode = values.attendance_mode;
  }
  if (lockWindowDays !== current.lock_window_days) changes.lockWindowDays = lockWindowDays;
  if (threshold !== current.leave_escalation_threshold_days) {
    changes.leaveEscalationThresholdDays = threshold;
  }
  return changes;
}
