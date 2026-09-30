import { THEME_PRESETS } from "@schoolhub/ui";

/**
 * Every layout preference a viewer can set, in one place.
 *
 * Each entry owns three things: the values it accepts, what it falls back to, and the
 * `<html>` attribute CSS reads it through. A cookie value outside `values` is discarded
 * rather than trusted — a cookie is client-writable, and an unvalidated one would land
 * straight in a `data-` attribute.
 *
 * Trimmed relative to the pre-Metronic-rebuild version: `sidebar_collapsible` and
 * `sidebar_state` are gone. The old shell's shadcn/ui Sidebar genuinely had two distinct
 * collapse behaviours ("icon" vs "offcanvas"); Metronic's own sidebar only ever collapses
 * to an icon rail (hover-to-expand, `.sidebar-collapse` in demos/demo1.css) — offering a
 * choice between two options that behave identically would be exactly the kind of
 * decorative-but-inert control this app avoids elsewhere (see login-form.tsx dropping
 * Metronic's non-functional "Remember me"). `content_layout` no longer needs its own
 * `data-content-layout` CSS either — `partials/common/container.tsx` reads this preference
 * directly instead of Metronic's separate `shell/settings.ts` `container` field, which
 * only that one component ever read.
 *
 * `theme_preset` defaults to "metronic", not the pre-Metronic shell's "tenant" — this
 * dashboard's whole shell is built on Metronic's look now, so a first-time visitor should
 * see it rather than the platform's Aurora default. `theme_preset`'s own docs (THEME_PRESETS
 * in packages/ui) still explain what "tenant" and every other value do.
 */

export const SIDEBAR_VARIANTS = ["sidebar", "inset", "floating"] as const;
export const CONTENT_LAYOUTS = ["full-width", "centered"] as const;
export const NAVBAR_STYLES = ["sticky", "scroll"] as const;

export const PREFERENCE_REGISTRY = {
  theme_preset: {
    values: THEME_PRESETS,
    defaultValue: "metronic",
    attribute: "data-theme-preset",
  },
  sidebar_variant: {
    values: SIDEBAR_VARIANTS,
    defaultValue: "sidebar",
    attribute: "data-sidebar-variant",
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
