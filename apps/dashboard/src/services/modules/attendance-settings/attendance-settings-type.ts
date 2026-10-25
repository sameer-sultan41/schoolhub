import type { ApiSchemas } from "@schoolhub/api-client";

/** The generated wire shapes (ADR-0017). */
export type AttendanceSettings = ApiSchemas["AttendanceSettings"];
export type AttendanceMode = ApiSchemas["AttendanceModeEnum"];

/** The settings a save changes: a key left out is not sent, so it is not touched. */
export interface AttendanceSettingsInput {
  attendanceMode?: AttendanceMode;
  lockWindowDays?: number;
  leaveEscalationThresholdDays?: number;
}
