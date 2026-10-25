import { fetchSettings, updateSettings } from "./attendance-settings-service";

export const AttendanceSettingsService = {
  fetchSettings,
  updateSettings,
};
export type {
  AttendanceMode,
  AttendanceSettings,
  AttendanceSettingsInput,
} from "./attendance-settings-type";
