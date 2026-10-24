import {
  buildSettingsChanges,
  isWholeNumberInRange,
  settingsToFormValues,
} from "../attendance-settings-helper";
import { attendanceSettingsFormSchema } from "../attendance-settings.schema";
import { attendanceSettings } from "./attendance-settings-fixtures";

describe("attendance-settings-helper", () => {
  it("shows the settings as the form's strings", () => {
    expect(settingsToFormValues(attendanceSettings({ lock_window_days: 0 }))).toEqual({
      attendance_mode: "daily",
      lock_window_days: "0",
      leave_escalation_threshold_days: "10",
    });
  });

  it("builds no changes from an untouched form", () => {
    const current = attendanceSettings();

    expect(buildSettingsChanges(settingsToFormValues(current), current)).toEqual({});
  });

  it("keeps only what differs, so an unchanged period mode is never re-sent", () => {
    const current = attendanceSettings({ attendance_mode: "period" });
    const values = { ...settingsToFormValues(current), lock_window_days: "5" };

    expect(buildSettingsChanges(values, current)).toEqual({ lockWindowDays: 5 });
  });

  it("builds all three when all three changed, a lock window of zero included", () => {
    const current = attendanceSettings();
    const values = {
      attendance_mode: "period" as const,
      lock_window_days: "0",
      leave_escalation_threshold_days: " 14 ",
    };

    expect(buildSettingsChanges(values, current)).toEqual({
      attendanceMode: "period",
      lockWindowDays: 0,
      leaveEscalationThresholdDays: 14,
    });
  });

  it("takes whole numbers in range only", () => {
    expect(isWholeNumberInRange("0", 0, 7)).toBe(true);
    expect(isWholeNumberInRange("7", 0, 7)).toBe(true);
    expect(isWholeNumberInRange("8", 0, 7)).toBe(false);
    expect(isWholeNumberInRange("", 0, 7)).toBe(false);
    expect(isWholeNumberInRange("2.5", 0, 7)).toBe(false);
    expect(isWholeNumberInRange("-1", 0, 7)).toBe(false);
  });

  it("holds the form to §19's bounds: lock window 0-7, escalation at least 1", () => {
    const values = settingsToFormValues(attendanceSettings());
    const parse = (change: Partial<typeof values>) =>
      attendanceSettingsFormSchema.safeParse({ ...values, ...change }).success;

    expect(parse({})).toBe(true);
    expect(parse({ lock_window_days: "0" })).toBe(true);
    expect(parse({ lock_window_days: "8" })).toBe(false);
    expect(parse({ lock_window_days: "" })).toBe(false);
    expect(parse({ leave_escalation_threshold_days: "1" })).toBe(true);
    expect(parse({ leave_escalation_threshold_days: "0" })).toBe(false);
    expect(parse({ attendance_mode: "hourly" as never })).toBe(false);
  });
});
