import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toSettingsBody } from "./attendance-settings-helper";
import type { AttendanceSettings, AttendanceSettingsInput } from "./attendance-settings-type";

/** The attendance settings API calls (`/attendance-settings`), reached through
 * `Services.attendanceSettings.*`. */

/** The effective values, with the server's defaults applied. */
export async function fetchSettings(): Promise<AttendanceSettings> {
  const { data } = await apiClient.get<AttendanceSettings>(endpoints.attendanceSettings.detail);
  return data;
}

/** Changes the keys in `input` and leaves the rest; answers with all three as they now stand. */
export async function updateSettings(input: AttendanceSettingsInput): Promise<AttendanceSettings> {
  const { data } = await apiClient.patch<AttendanceSettings>(
    endpoints.attendanceSettings.detail,
    toSettingsBody(input),
  );
  return data;
}
