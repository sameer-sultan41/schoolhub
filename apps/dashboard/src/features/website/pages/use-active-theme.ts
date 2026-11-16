"use client";

import { useMemo } from "react";

import type { ThemeSectionType } from "@/services";
import { themeSectionTypes } from "@/services/modules/website/themes/themes-helper";
import { useThemes, useWebsiteSettings } from "@/features/website/shared/use-website-settings";

export type SectionTypes = Record<string, ThemeSectionType>;

/**
 * The section catalogue of the site's active theme (decision 6): `GET /website-settings` names
 * the theme (its unsaved default before the first save), `GET /themes` holds its section
 * schemas. `missing` is true when the settings name a theme the platform no longer ships.
 */
export function useActiveTheme() {
  const settingsQuery = useWebsiteSettings();
  const themesQuery = useThemes();

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
