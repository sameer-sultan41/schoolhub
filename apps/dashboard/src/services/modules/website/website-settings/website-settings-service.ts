import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { WebsiteSettingsInput, WebsiteSettingsRecord } from "./website-settings-type";

/** The site settings API calls (`/website-settings`), reached through `Services.websiteSettings.*`. */

export async function fetchWebsiteSettings(): Promise<WebsiteSettingsRecord> {
  const { data } = await apiClient.get<WebsiteSettingsRecord>(endpoints.website.settings);
  return data;
}

/** The first save also creates the default site (its eight draft pages). */
export async function updateWebsiteSettings(
  input: WebsiteSettingsInput,
): Promise<WebsiteSettingsRecord> {
  const { data } = await apiClient.patch<WebsiteSettingsRecord>(endpoints.website.settings, input);
  return data;
}
