import { defaultTheme } from "./default";
import type { SectionComponent, Theme } from "./types";
import type { PageSection } from "@schoolhub/types";

/**
 * Theme registry.
 *
 * v1 ships one theme, but it is registered rather than special-cased: adding a theme is a
 * registry entry plus its components. Themes are platform code — **no per-tenant custom
 * code, ever** (website-builder.md §5).
 */
export const THEMES: Record<string, Theme> = {
  [defaultTheme.name]: defaultTheme,
};

export const DEFAULT_THEME_NAME = defaultTheme.name;

/** Falls back to the default theme for an unknown/removed theme name. */
export function getTheme(name: string | null | undefined): Theme {
  if (!name) return defaultTheme;
  return THEMES[name] ?? defaultTheme;
}

/** Resolve a section row to its component, or null when this theme skips the type. */
export function resolveSection(theme: Theme, section: PageSection): SectionComponent | null {
  const component = theme.sections[section.type as keyof Theme["sections"]];
  return component ?? null;
}

export type { ChromeProps, SectionComponent, SectionProps, Theme } from "./types";
