import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toSeoTargetParams } from "./seo-settings-helper";
import type { SeoSettingInput, SeoSettingRecord, SeoTarget } from "./seo-settings-type";

/** The SEO API calls (`/seo-settings`), reached through `Services.seoSettings.*`. */

export async function fetchSeoSetting(target: SeoTarget): Promise<SeoSettingRecord> {
  const { data } = await apiClient.get<SeoSettingRecord>(endpoints.website.seo, {
    query: toSeoTargetParams(target),
  });
  return data;
}

export async function updateSeoSetting(
  target: SeoTarget,
  input: SeoSettingInput,
): Promise<SeoSettingRecord> {
  const { data } = await apiClient.patch<SeoSettingRecord>(endpoints.website.seo, input, {
    query: toSeoTargetParams(target),
  });
  return data;
}
