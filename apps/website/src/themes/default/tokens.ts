import type { TenantBranding } from "@schoolhub/types";
import { brandingToCssVariables } from "@schoolhub/ui";
import type { CSSProperties } from "react";

/**
 * Theme token contract for theme v1 (website-builder.md §2).
 *
 * A theme declares which tokens it consumes and a default for each. Tenant branding
 * overrides them at render time as CSS custom properties, so one theme renders visually
 * distinct per school **with zero code differences** — and a school that configured nothing
 * still gets a coherent, neutral site rather than a half-styled one.
 *
 * When a future theme adds a token it must declare a default here too, so existing
 * branding maps cleanly onto it (website-builder.md §5).
 */
export const THEME_TOKENS = [
  "--sh-color-primary",
  "--sh-color-secondary",
  "--sh-color-accent",
  "--sh-color-background",
  "--sh-color-foreground",
  "--sh-font-heading",
  "--sh-font-body",
  "--sh-radius",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** Neutral defaults — deliberately not a brand. Overridden by tenant branding. */
export const DEFAULT_THEME_TOKENS: Record<ThemeToken, string> = {
  "--sh-color-primary": "oklch(0.37 0.013 285.8)",
  "--sh-color-secondary": "oklch(0.967 0.001 286.4)",
  "--sh-color-accent": "oklch(0.967 0.001 286.4)",
  "--sh-color-background": "oklch(1 0 0)",
  "--sh-color-foreground": "oklch(0.21 0.006 285.9)",
  "--sh-font-heading": "ui-sans-serif, system-ui, sans-serif",
  "--sh-font-body": "ui-sans-serif, system-ui, sans-serif",
  "--sh-radius": "0.5rem",
};

/**
 * Merge the theme defaults with the tenant's branding into a style object.
 * Values are sanitized in `@schoolhub/ui` before they reach CSS.
 */
export function themeStyle(branding: TenantBranding | null | undefined): CSSProperties {
  return { ...DEFAULT_THEME_TOKENS, ...brandingToCssVariables(branding) } as CSSProperties;
}
