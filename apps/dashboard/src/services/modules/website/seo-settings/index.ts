import { fetchSeoSetting, updateSeoSetting } from "./seo-settings-service";

export const SeoSettingsService = {
  fetchSeoSetting,
  updateSeoSetting,
};
export type {
  SeoSettingInput,
  SeoSettingRecord,
  SeoTarget,
  SeoTargetType,
} from "./seo-settings-type";
