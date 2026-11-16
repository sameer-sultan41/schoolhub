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

/**
 * A functional colour in the grammar the API emits (`BRANDING_COLOUR_RE` in
 * `apps/api/apps/website_cms/constants.py`): only digits, `.`, `%`, spaces, commas and `/`
 * inside the parentheses, so it cannot close the declaration or open another.
 */
export const FUNCTIONAL_COLOUR_PATTERN = /^(?:rgba?|hsla?|oklch)\([0-9.%, /]+\)$/;

const MAX_CSS_VALUE_LENGTH = 120;

function trimmedValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CSS_VALUE_LENGTH) return null;
  return trimmed;
}

export function sanitizeCssValue(value: string | null | undefined): string | null {
  const trimmed = trimmedValue(value);
  if (trimmed === null || UNSAFE_CSS_VALUE.test(trimmed)) return null;
  return trimmed;
}

/** Like `sanitizeCssValue`, but also accepts `rgb()`/`hsl()`/`oklch()` in the anchored grammar above. */
export function sanitizeCssColour(value: string | null | undefined): string | null {
  const trimmed = trimmedValue(value);
  if (trimmed !== null && FUNCTIONAL_COLOUR_PATTERN.test(trimmed)) return trimmed;
  return sanitizeCssValue(value);
}

/**
 * `heading_font`/`body_font` REPLACE the whole `--sh-font-*` property, not just prepend to
 * it — same "tenant value wins outright" contract as every other row here. The platform
 * default those properties fall back to (theme.css) chains Inter/Fraunces *then* Noto
 * Nastaliq Urdu, so Urdu glyphs render correctly with no `[lang="ur"]` override needed. A
 * tenant that sets a Latin-only custom `body_font` (e.g. "Poppins, sans-serif") loses that
 * fallback entirely for their own site — their Urdu-locale UI text falls through to
 * whatever generic sans-serif the visitor's OS ships, which typically has no Nastaliq
 * shaping. This is accepted as the correct behaviour of "tenant branding always wins", not
 * a bug: overriding it to silently re-inject Nastaliq would contradict that contract. If a
 * tenant-configurable Urdu-safe font list becomes a real complaint, that is a product
 * decision (e.g. validate `body_font` against a font that covers the tenant's own locales
 * at branding-save time), not something to paper over here.
 */
const TOKEN_MAP: ReadonlyArray<
  [keyof TenantBranding, string, (value: string | null | undefined) => string | null]
> = [
  ["primary_color", "--sh-color-primary", sanitizeCssColour],
  ["secondary_color", "--sh-color-secondary", sanitizeCssColour],
  ["accent_color", "--sh-color-accent", sanitizeCssColour],
  ["background_color", "--sh-color-background", sanitizeCssColour],
  ["foreground_color", "--sh-color-foreground", sanitizeCssColour],
  ["heading_font", "--sh-font-heading", sanitizeCssValue],
  ["body_font", "--sh-font-body", sanitizeCssValue],
  ["radius", "--sh-radius", sanitizeCssValue],
];

/**
 * @returns a style object to spread onto a wrapper element (or `<html>`), e.g.
 * `<div style={brandingToCssVariables(tenant.branding)}>`.
 */
export function brandingToCssVariables(branding: TenantBranding | null | undefined): CSSProperties {
  const style: Record<string, string> = {};
  if (!branding) return style;

  for (const [field, token, sanitize] of TOKEN_MAP) {
    const value = sanitize(branding[field]);
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
