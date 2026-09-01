import type { TenantBranding } from "@schoolhub/types";
// Deep import, not the package root: this file needs one plain function, not any
// component, so importing it directly keeps this file's own module graph minimal — even
// though other files in this app legitimately import Button/Card/etc. from the barrel
// anyway (see packages/ui/src/components/form.tsx for the sonner-leak this doesn't, by
// itself, solve).
import { brandingToCssVariables } from "@schoolhub/ui/lib/branding";
import type { CSSProperties } from "react";

/**
 * Theme token contract for theme v1 (website-builder.md §2).
 *
 * A theme declares which tokens it consumes; website-builder.md §5 requires a default for
 * each so existing branding maps cleanly onto a future one. That default lives in exactly
 * ONE place — `packages/ui/src/styles/theme.css`'s `:root` block — not duplicated here.
 * This file used to also hardcode a `DEFAULT_THEME_TOKENS` value object and force every
 * one of these 8 properties onto `<html>` via inline style regardless of whether the
 * tenant had branding. Two problems with that: the literal values silently drifted out of
 * sync with theme.css's own defaults, and setting them unconditionally on `<html>`
 * permanently overrode theme.css's `@media (prefers-color-scheme: dark)` block — the
 * public site was locked to light mode for every tenant, branded or not. `themeStyle`
 * below now only ever sets a property when the tenant actually supplied a value (the same
 * pattern `apps/dashboard`'s `TenantTheme` already uses): everything else is left unset on
 * the inline style so the normal CSS cascade — `:root`'s light default, or its dark-mode
 * override — applies exactly as it would for any other element.
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

/**
 * Project the tenant's branding onto a style object for `<html>`. Absent fields are
 * omitted (not backfilled with a duplicated default) so `:root` in theme.css — including
 * its dark-mode override — keeps governing everything the tenant didn't set.
 */
export function themeStyle(branding: TenantBranding | null | undefined): CSSProperties {
  return brandingToCssVariables(branding);
}
