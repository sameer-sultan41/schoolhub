"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services, type ThemeSectionType } from "@/services";
import { THEMES_RESOURCE } from "@/services/modules/website/themes/themes-constant";
import { themeSectionTypes } from "@/services/modules/website/themes/themes-helper";
import { WEBSITE_SETTINGS_RESOURCE } from "@/services/modules/website/website-settings/website-settings-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";

export type SectionTypes = Record<string, ThemeSectionType>;

/** The detail key `GET /website-settings` is read under: the tenant has one settings row. */
const SETTINGS_KEY = "current";

/**
 * The section catalogue of the site's active theme (decision 6): `GET /website-settings` names
 * the theme (its unsaved default before the first save), `GET /themes` holds its section
 * schemas. `missing` is true when the settings name a theme the platform no longer ships.
 */
export function useActiveTheme() {
  const settingsQuery = useQuery({
    queryKey: queryKeys.detail(WEBSITE_QUERY_MODULE, WEBSITE_SETTINGS_RESOURCE, SETTINGS_KEY),
    queryFn: () => Services.websiteSettings.fetchWebsiteSettings(),
  });
  const themesQuery = useQuery({
    queryKey: queryKeys.list(WEBSITE_QUERY_MODULE, THEMES_RESOURCE),
    queryFn: () => Services.themes.fetchThemes(),
  });

  const themeCode = settingsQuery.data?.theme_code;
  const theme = themesQuery.data?.find((candidate) => candidate.code === themeCode);
  // Memoized on the theme, so the editor's resolver and defaults built from it stay put.
  const sectionTypes = useMemo<SectionTypes | undefined>(
    () => (theme ? themeSectionTypes(theme) : undefined),
    [theme],
  );

  return {
    sectionTypes,
    isPending: settingsQuery.isPending || themesQuery.isPending,
    error: settingsQuery.error ?? themesQuery.error,
    missing: settingsQuery.isSuccess && themesQuery.isSuccess && theme === undefined,
    refetch: () => {
      void settingsQuery.refetch();
      void themesQuery.refetch();
    },
  };
}
