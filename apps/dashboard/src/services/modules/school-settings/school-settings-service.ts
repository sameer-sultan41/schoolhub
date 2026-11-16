import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { SchoolSettingsRecord, SchoolSettingsUpdate } from "./school-settings-type";

/** The school profile and configuration (`/school-settings`), reached through
 * `Services.schoolSettings.*`. */

export async function fetchSchoolSettings(): Promise<SchoolSettingsRecord> {
  const { data } = await apiClient.get<SchoolSettingsRecord>(endpoints.schoolSettings.detail);
  return data;
}

export async function updateSchoolSettings(
  body: SchoolSettingsUpdate,
): Promise<SchoolSettingsRecord> {
  const { data } = await apiClient.patch<SchoolSettingsRecord>(
    endpoints.schoolSettings.detail,
    body,
  );
  return data;
}
