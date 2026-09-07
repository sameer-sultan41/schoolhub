import { THEME_PRESETS } from "@schoolhub/ui";

/**
 * Every layout preference a viewer can set, in one place.
 *
 * Each entry owns three things: the values it accepts, what it falls back to, and the
 * `<html>` attribute CSS reads it through. A cookie value outside `values` is discarded
 * rather than trusted — a cookie is client-writable, and an unvalidated one would land
 * straight in a `data-` attribute.
 *
 * Two of the template's preferences are deliberately absent. `theme_mode`: next-themes
 * already owns the `.dark` class the dark variant matches, ships its own no-flicker
 * script, and its control is pinned by e2e as "Change theme" — a second owner of that
 * class is a race. `font`: --sh-font-body/--sh-font-heading carry the tenant's own branding, and
 * Urdu needs Noto Nastaliq, so a viewer-level font picker would fight both.
 */

export const SIDEBAR_VARIANTS = ["sidebar", "inset", "floating"] as const;
export const SIDEBAR_COLLAPSE_MODES = ["icon", "offcanvas"] as const;
export const SIDEBAR_STATES = ["expanded", "collapsed"] as const;
export const CONTENT_LAYOUTS = ["full-width", "centered"] as const;
export const NAVBAR_STYLES = ["sticky", "scroll"] as const;

export const PREFERENCE_REGISTRY = {
  theme_preset: {
    values: THEME_PRESETS,
    defaultValue: "tenant",
    attribute: "data-theme-preset",
  },
  sidebar_variant: {
    values: SIDEBAR_VARIANTS,
    defaultValue: "sidebar",
    attribute: "data-sidebar-variant",
  },
  sidebar_collapsible: {
    values: SIDEBAR_COLLAPSE_MODES,
    defaultValue: "icon",
    attribute: "data-sidebar-collapsible",
  },
  sidebar_state: {
    values: SIDEBAR_STATES,
    defaultValue: "expanded",
    attribute: "data-sidebar-state",
  },
  content_layout: {
    values: CONTENT_LAYOUTS,
    defaultValue: "full-width",
    attribute: "data-content-layout",
  },
  navbar_style: {
    values: NAVBAR_STYLES,
    defaultValue: "sticky",
    attribute: "data-navbar-style",
  },
} as const;

export type PreferenceKey = keyof typeof PREFERENCE_REGISTRY;

export type PreferenceValues = {
  [K in PreferenceKey]: (typeof PREFERENCE_REGISTRY)[K]["values"][number];
};

export const PREFERENCE_KEYS = Object.keys(PREFERENCE_REGISTRY) as PreferenceKey[];

export const PREFERENCE_DEFAULTS = Object.fromEntries(
  PREFERENCE_KEYS.map((key) => [key, PREFERENCE_REGISTRY[key].defaultValue]),
) as PreferenceValues;

/** A cookie value, or the default when it is missing or not one this key accepts. */
export function parsePreference<K extends PreferenceKey>(
  key: K,
  raw: string | undefined,
): PreferenceValues[K] {
  const definition = PREFERENCE_REGISTRY[key];
  const accepted: readonly string[] = definition.values;
  return (
    raw !== undefined && accepted.includes(raw) ? raw : definition.defaultValue
  ) as PreferenceValues[K];
}

/** The `<html>` attributes for a set of values — the only channel CSS reads them through. */
export function preferenceDataAttributes(values: PreferenceValues): Record<string, string> {
  return Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [PREFERENCE_REGISTRY[key].attribute, values[key]]),
  );
}
