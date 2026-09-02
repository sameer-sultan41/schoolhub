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

/** #rgb, #rgba, #rrggbb, or #rrggbbaa. */
const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** rgb(r, g, b) or rgba(r, g, b, a), each channel 1-3 digits. */
const RGB_COLOR_PATTERN =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i;

export function sanitizeCssValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return null;
  if (UNSAFE_CSS_VALUE.test(trimmed)) return null;
  return trimmed;
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

/**
 * non-functional.md §5: "tenant branding choices (colors) are contrast-validated with a
 * warning on failure." Parses opaque #rgb/#rrggbb and rgb()/rgba() only — the common case
 * for a colour-picker-driven settings form. Anything else is skipped rather than flagged: a
 * false "fails contrast" on a value this cannot parse would be worse than not checking it
 * at all. That includes any value carrying an alpha channel (#rgba, #rrggbbaa, an explicit
 * rgba() alpha argument): this function has no backdrop to composite against, so treating
 * one as opaque would risk the opposite mistake — a false PASS on a colour that renders
 * translucent and reads at a lower contrast than its own channel values suggest.
 */
function parseColorToRgb(value: string): [number, number, number] | null {
  const hex = HEX_COLOR_PATTERN.exec(value.trim());
  const hexDigits = hex?.[1];
  if (hexDigits) {
    // 4/8-digit forms carry an alpha channel this function has no way to composite against
    // an unknown backdrop — treating it as opaque would score a translucent colour as fully
    // solid, exactly the false pass this function exists to avoid. Skipped, per the same
    // policy as an unparseable value.
    if (hexDigits.length === 4 || hexDigits.length === 8) return null;
    // #rgb shorthand expands each digit to a pair, e.g. "a1" from "a".
    const expanded =
      hexDigits.length === 3
        ? hexDigits
            .split("")
            .map((d) => d + d)
            .join("")
        : hexDigits;
    const r = Number.parseInt(expanded.slice(0, 2), 16);
    const g = Number.parseInt(expanded.slice(2, 4), 16);
    const b = Number.parseInt(expanded.slice(4, 6), 16);
    return [r, g, b];
  }

  const rgb = RGB_COLOR_PATTERN.exec(value.trim());
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    // Same reasoning as the hex case above: an explicit alpha argument means this colour is
    // translucent, which this function cannot correctly score without knowing the backdrop.
    if (rgb[4] !== undefined) return null;
    const r = Number.parseInt(rgb[1], 10);
    const g = Number.parseInt(rgb[2], 10);
    const b = Number.parseInt(rgb[3], 10);
    if (r <= 255 && g <= 255 && b <= 255) return [r, g, b];
  }

  return null;
}

/** WCAG relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio); 1–21. */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.1 AA for normal text — the bar non-functional.md §5 sets platform-wide. */
const MIN_AA_CONTRAST = 4.5;

/**
 * The platform's own fixed `--sh-color-*-foreground` defaults (theme.css) — never
 * tenant-overridable (TOKEN_MAP above has no `*_foreground` entries), so a tenant's own
 * primary_color/secondary_color/accent_color is the only side of each pairing they
 * control. Kept as literals here rather than imported from CSS: this function has no
 * access to a live stylesheet, and a hardcoded snapshot of the real default is the correct
 * fixed reference point, not a magic number — update these if theme.css's own defaults
 * ever change. Light mode only, same limitation as PLATFORM_FOREGROUND above: primary's and
 * secondary's dark-mode foreground differs from these (accent's happens not to).
 */
const PLATFORM_PRIMARY_FOREGROUND: [number, number, number] = [0xfb, 0xf7, 0xee]; // Ivory #FBF7EE
// secondary_color and accent_color both pair against the platform's fixed Indigo text
// (theme.css's --sh-color-secondary-foreground/--sh-color-accent-foreground, never
// tenant-overridable) — a pale/marigold surface with dark indigo text on top, the reverse
// of primary/danger's light-text-on-saturated-surface pairing above.
const PLATFORM_SECONDARY_ACCENT_FOREGROUND: [number, number, number] = [0x2b, 0x2a, 0x6b]; // Indigo #2B2A6B
// theme.css :root light-mode defaults — the pairing a tenant who sets only ONE side of
// foreground/background actually renders against, so this must fall back exactly like
// PLATFORM_BACKGROUND does, on both sides. Light mode only: theme.css's own dark-mode media
// query swaps both of these (to #09090b / #fafafa), which this heuristic does not check —
// a tenant-set foreground_color with no background_color is validated against light mode
// only, and could still be unreadable for a visitor whose OS prefers dark.
const PLATFORM_FOREGROUND: [number, number, number] = [0x18, 0x18, 0x1b]; // #18181b
const PLATFORM_BACKGROUND: [number, number, number] = [0xff, 0xff, 0xff]; // White #FFFFFF

export interface ContrastWarning {
  pair:
    | "foreground_color/background_color"
    | "primary_color/primary_text"
    | "secondary_color/secondary_text"
    | "accent_color/accent_text";
  ratio: number;
}

/**
 * Checks the highest-impact pairings — body text, plus every tenant-brandable colour
 * TOKEN_MAP maps onto a surface with its own fixed platform text colour on top
 * (primary/secondary/accent) — not every possible token combination. Returns warnings,
 * never blocks: this repo's own bar is "warning on failure," and a tenant may have
 * real-world reasons (an existing brand guideline) for a choice that reads as low-contrast
 * to this heuristic. A pair where either colour cannot be parsed (see parseColorToRgb) is
 * silently skipped, not warned.
 */
export function checkBrandingContrast(
  branding: TenantBranding | null | undefined,
): ContrastWarning[] {
  if (!branding) return [];
  const warnings: ContrastWarning[] = [];

  const foreground = branding.foreground_color
    ? parseColorToRgb(branding.foreground_color)
    : PLATFORM_FOREGROUND;
  const background = branding.background_color
    ? parseColorToRgb(branding.background_color)
    : PLATFORM_BACKGROUND;
  if (foreground && background) {
    const ratio = contrastRatio(foreground, background);
    if (ratio < MIN_AA_CONTRAST)
      warnings.push({ pair: "foreground_color/background_color", ratio });
  }

  const primary = branding.primary_color ? parseColorToRgb(branding.primary_color) : null;
  if (primary) {
    const ratio = contrastRatio(primary, PLATFORM_PRIMARY_FOREGROUND);
    if (ratio < MIN_AA_CONTRAST) warnings.push({ pair: "primary_color/primary_text", ratio });
  }

  const secondary = branding.secondary_color ? parseColorToRgb(branding.secondary_color) : null;
  if (secondary) {
    const ratio = contrastRatio(secondary, PLATFORM_SECONDARY_ACCENT_FOREGROUND);
    if (ratio < MIN_AA_CONTRAST) warnings.push({ pair: "secondary_color/secondary_text", ratio });
  }

  const accent = branding.accent_color ? parseColorToRgb(branding.accent_color) : null;
  if (accent) {
    const ratio = contrastRatio(accent, PLATFORM_SECONDARY_ACCENT_FOREGROUND);
    if (ratio < MIN_AA_CONTRAST) warnings.push({ pair: "accent_color/accent_text", ratio });
  }

  return warnings;
}
