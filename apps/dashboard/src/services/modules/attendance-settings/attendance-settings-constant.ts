import type { AttendanceMode, AttendanceSettingsInput } from "./attendance-settings-type";

/** The attendance-settings module's constants. */

/** The query-key module and resource the settings read lives under; a save invalidates it. */
export const ATTENDANCE_SETTINGS_QUERY_MODULE = "attendance-settings";
export const ATTENDANCE_SETTINGS_RESOURCE = "settings";
/** The one settings row of a tenant has no id: a stand-in for `queryKeys.detail`. */
export const ATTENDANCE_SETTINGS_ID = "current";

/** Every mode, keyed so the compiler checks the set against the generated enum. */
const MODE_SET: Record<AttendanceMode, true> = { daily: true, period: true };
export const ATTENDANCE_MODES = Object.keys(MODE_SET) as AttendanceMode[];

/** Lock window bounds, in days (`attendance.md` §19; the API's `MAX_LOCK_WINDOW_DAYS`). */
export const LOCK_WINDOW_MIN_DAYS = 0;
export const LOCK_WINDOW_MAX_DAYS = 7;

/** An escalation threshold of zero would escalate every single-day leave. */
export const ESCALATION_THRESHOLD_MIN_DAYS = 1;

/** camelCase `AttendanceSettingsInput` key -> the API body key. */
export const ATTENDANCE_SETTINGS_BODY_FIELDS: ReadonlyArray<
  readonly [keyof AttendanceSettingsInput, string]
> = [
  ["attendanceMode", "attendance_mode"],
  ["lockWindowDays", "lock_window_days"],
  ["leaveEscalationThresholdDays", "leave_escalation_threshold_days"],
];

/** Fields a server error may name in the settings form; any other is the form's message. */
export const ATTENDANCE_SETTINGS_ERROR_FIELDS = [
  "attendance_mode",
  "lock_window_days",
  "leave_escalation_threshold_days",
] as const;
