/**
 * The colour presets a viewer can choose between.
 *
 * "tenant" is not a stylesheet — it is the absence of one. Under it, tenant-theme.tsx
 * applies the school's own branding as inline custom properties, which beat any
 * [data-theme-preset] rule on specificity. Choosing any other preset is a viewer saying
 * "show me this palette, not my school's", so the branding is withheld and the preset's
 * stylesheet wins.
 *
 * "metronic" is the Metronic admin template's own default palette (config.reui.css),
 * reproduced as shipped rather than redesigned — see metronic.css's own header for the
 * one real AA gap that comes with copying it verbatim. apps/website deliberately imports
 * neither preset's stylesheet — it has no switcher, and every page there must wear its
 * tenant's brand.
 *
 * TODO(multi-theme): six other presets — ink-brass, azure, cobalt, tangerine, soft-pop,
 * brutalist, neon — existed here and were removed to keep the product on a single
 * Metronic look while that's the only palette actively being worked on. Nothing about
 * them was wrong; their stylesheets (and this array's former entries) are recoverable
 * verbatim from git history (see the commit that trimmed this file) whenever multi-theme
 * support returns. Re-adding one means: restore its `./presets/<name>.css`, add its id
 * back here, add it back to `shared-chrome.css`'s selector list, re-add its
 * `nav.preferences.preset.<name>` message key to both `messages/en.json` and
 * `messages/ur.json`, and re-add its `@import` to the dashboard's `globals.css`.
 */
export const THEME_PRESETS = ["tenant", "metronic"] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];
