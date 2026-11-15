import { fetchWebsiteSettings, updateWebsiteSettings } from "./website-settings-service";

export const WebsiteSettingsService = {
  fetchWebsiteSettings,
  updateWebsiteSettings,
};
export type {
  SocialLink,
  WebsiteSettingsInput,
  WebsiteSettingsRecord,
} from "./website-settings-type";
