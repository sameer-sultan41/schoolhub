import { z } from "zod";
import {
  ATTENDANCE_MODES,
  ESCALATION_THRESHOLD_MIN_DAYS,
  LOCK_WINDOW_MAX_DAYS,
  LOCK_WINDOW_MIN_DAYS,
} from "./attendance-settings-constant";
import { isWholeNumberInRange } from "./attendance-settings-helper";
import type { AttendanceMode } from "./attendance-settings-type";

/** The settings form's schema, with the API's own field names. */

export type AttendanceSettingsFormMessages = Record<
  "lockWindowInvalid" | "thresholdInvalid",
  string
>;

export const ATTENDANCE_SETTINGS_FORM_MESSAGE_KEYS: AttendanceSettingsFormMessages = {
  lockWindowInvalid: "lockWindowInvalid",
  thresholdInvalid: "thresholdInvalid",
};

/**
 * The two day counts are strings, not numbers: a cleared number input reads as NaN, which a
 * `z.number()` can't tell apart from a typo. The bounds are the API's (`attendance.md` §19).
 */
export function createAttendanceSettingsFormSchema(messages: AttendanceSettingsFormMessages) {
  return z.object({
    attendance_mode: z.enum(ATTENDANCE_MODES as [AttendanceMode, ...AttendanceMode[]]),
    lock_window_days: z
      .string()
      .refine(
        (value) => isWholeNumberInRange(value, LOCK_WINDOW_MIN_DAYS, LOCK_WINDOW_MAX_DAYS),
        messages.lockWindowInvalid,
      ),
    leave_escalation_threshold_days: z
      .string()
      .refine(
        (value) =>
          isWholeNumberInRange(value, ESCALATION_THRESHOLD_MIN_DAYS, Number.MAX_SAFE_INTEGER),
        messages.thresholdInvalid,
      ),
  });
}

export const attendanceSettingsFormSchema = createAttendanceSettingsFormSchema(
  ATTENDANCE_SETTINGS_FORM_MESSAGE_KEYS,
);

export type AttendanceSettingsFormValues = z.infer<typeof attendanceSettingsFormSchema>;
