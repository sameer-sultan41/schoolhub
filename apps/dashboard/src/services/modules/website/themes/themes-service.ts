import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type { ThemeRecord } from "./themes-type";

/** The themes API call (`/themes`, code-declared and read-only), through `Services.themes.*`. */

/** Every theme: a platform ships a handful, so one `MAX_PAGE_SIZE` page holds them. */
export async function fetchThemes(): Promise<ThemeRecord[]> {
  const { items } = await fetchPage<ThemeRecord>(apiClient, endpoints.website.themes, {
    query: { page_size: MAX_PAGE_SIZE },
  });
  return items;
}
