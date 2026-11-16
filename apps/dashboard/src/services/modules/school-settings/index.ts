import { fetchSchoolSettings, updateSchoolSettings } from "./school-settings-service";

export const SchoolSettingsService = {
  fetchSchoolSettings,
  updateSchoolSettings,
};
export type { SchoolSettingsRecord, SchoolSettingsUpdate } from "./school-settings-type";
