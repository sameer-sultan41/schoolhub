/**
 * The colour presets a viewer can choose between.
 *
 * "tenant" is not a stylesheet — it is the absence of one. Under it, tenant-theme.tsx
 * applies the school's own branding as inline custom properties, which beat any
 * [data-theme-preset] rule on specificity. Choosing any other preset is a viewer saying
 * "show me this palette, not my school's", so the branding is withheld and the preset's
 * stylesheet wins.
 *
 * "ink-brass" USED to be that same withholding with no stylesheet behind it, leaving
 * whatever theme.css's :root happened to contain. It has a real stylesheet now, because
 * :root stopped containing Ink & Brass: the platform default is Aurora, and without
 * ./presets/ink-brass.css this value would have quietly started meaning "Aurora with the
 * school's branding withheld" — a menu entry that kept its label and lost its palette.
 *
 * The five named presets each have a stylesheet under ./presets/, imported by the
 * dashboard's globals.css; four of them (tangerine, soft-pop, brutalist, neon) are
 * adapted from arhamkhnz/next-shadcn-admin-dashboard (MIT). apps/website deliberately
 * imports none of them — it has no switcher, and every page there must wear its tenant's
 * brand.
 */
export const THEME_PRESETS = [
  "tenant",
  "ink-brass",
  "tangerine",
  "soft-pop",
  "brutalist",
  "neon",
] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];
