import type { TenantBranding } from "@schoolhub/types";
import type { CSSProperties } from "react";

/**
 * Project a tenant's branding onto the `--sh-*` custom properties consumed by
 * `styles/theme.css`.
 *
 * This is the ONLY place a brand colour enters the UI. Components reference token
 * utilities (`bg-primary`, `text-foreground`, …); they never see a tenant's hex value.
 * Absent branding fields are simply omitted so the neutral defaults in `:root` win —
 * never substituted with an invented brand colour.
 *
 * Values come from the API, so they are treated as untrusted: anything that is not a
 * plausible CSS colour/length/font-stack is dropped rather than interpolated into CSS.
 */

/** Rejects the characters that could break out of a custom-property declaration. */
const UNSAFE_CSS_VALUE = /[;{}<>()\\]|\/\*|url\s*\(/i;

export function sanitizeCssValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  if (UNSAFE_CSS_VALUE.test(trimmed)) return null;
  return trimmed;
}

const TOKEN_MAP: ReadonlyArray<[keyof TenantBranding, string]> = [
  ["primary_color", "--sh-color-primary"],
  ["secondary_color", "--sh-color-secondary"],
  ["accent_color", "--sh-color-accent"],
  ["background_color", "--sh-color-background"],
  ["foreground_color", "--sh-color-foreground"],
  ["heading_font", "--sh-font-heading"],
  ["body_font", "--sh-font-body"],
  ["radius", "--sh-radius"],
];

/**
 * @returns a style object to spread onto a wrapper element (or `<html>`), e.g.
 * `<div style={brandingToCssVariables(tenant.branding)}>`.
 */
export function brandingToCssVariables(branding: TenantBranding | null | undefined): CSSProperties {
  const style: Record<string, string> = {};
  if (!branding) return style;

  for (const [field, token] of TOKEN_MAP) {
    const value = sanitizeCssValue(branding[field]);
    if (value) style[token] = value;
  }

  return style;
}

/** Same tokens as a CSS text block, for injecting into a `<style>` tag during SSR. */
export function brandingToCssText(
  branding: TenantBranding | null | undefined,
  selector = ":root",
): string {
  const entries = Object.entries(brandingToCssVariables(branding) as Record<string, string>);
  if (entries.length === 0) return "";
  const body = entries.map(([token, value]) => `${token}:${value}`).join(";");
  return `${selector}{${body}}`;
}
