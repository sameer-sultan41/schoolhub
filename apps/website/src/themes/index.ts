import { defaultTheme } from "./default";
import type { PublicSection, SectionComponent, Theme } from "./types";

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

/** Falls back to the default theme for an unknown/removed theme code. */
export function getTheme(name: string | null | undefined): Theme {
  if (!name) return defaultTheme;
  return THEMES[name] ?? defaultTheme;
}

/** Resolve a section row to its component, or null when this theme skips the type. */
export function resolveSection(theme: Theme, section: PublicSection): SectionComponent | null {
  // `Object.hasOwn` so a type the API adds before the renderer ships it renders nothing.
  if (!Object.hasOwn(theme.sections, section.type)) return null;
  return theme.sections[section.type] ?? null;
}

export type {
  ChromeProps,
  PublicSection,
  PublicSite,
  PublicTenant,
  SectionComponent,
  SectionProps,
  SectionType,
  Theme,
} from "./types";
