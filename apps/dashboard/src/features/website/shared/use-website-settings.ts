"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { THEMES_RESOURCE } from "@/services/modules/website/themes/themes-constant";
import {
  WEBSITE_SETTINGS_KEY,
  WEBSITE_SETTINGS_RESOURCE,
} from "@/services/modules/website/website-settings/website-settings-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";

/** `GET /website-settings`: the site row, or its unsaved default (`exists: false`). The page
 * editor and the settings screen share this cache entry. */
export function useWebsiteSettings() {
  return useQuery({
    queryKey: queryKeys.detail(
      WEBSITE_QUERY_MODULE,
      WEBSITE_SETTINGS_RESOURCE,
      WEBSITE_SETTINGS_KEY,
    ),
    queryFn: () => Services.websiteSettings.fetchWebsiteSettings(),
  });
}

/** `GET /themes`: every theme the platform ships, with its config and section schemas. */
export function useThemes() {
  return useQuery({
    queryKey: queryKeys.list(WEBSITE_QUERY_MODULE, THEMES_RESOURCE),
    queryFn: () => Services.themes.fetchThemes(),
  });
}
