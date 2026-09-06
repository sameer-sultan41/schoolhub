/**
 * The colour presets a viewer can choose between.
 *
 * "tenant" is not a stylesheet — it is the absence of one. Under it, tenant-theme.tsx
 * applies the school's own branding as inline custom properties, which beat any
 * [data-theme-preset] rule on specificity. Choosing any other preset is a viewer saying
 * "show me this palette, not my school's", so the branding is withheld and the preset's
 * stylesheet wins. "ink-brass" is that same withholding with no preset stylesheet behind
 * it, which leaves the platform default from theme.css's own :root.
 *
 * The three named presets are adapted from arhamkhnz/next-shadcn-admin-dashboard (MIT);
 * each has a stylesheet under ./presets/, imported by the dashboard's globals.css.
 * apps/website deliberately imports none of them — it has no switcher, and every page
 * there must wear its tenant's brand.
 */
export const THEME_PRESETS = ["tenant", "ink-brass", "tangerine", "soft-pop", "brutalist"] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];
