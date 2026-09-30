/**
 * Every cookie name this app sets or reads, in one place — same "one named object, not
 * scattered literals" convention as `regex.ts`'s `Regex` and `config/paths.ts`'s `Paths`.
 *
 * Preference cookies (`sidebar_variant`, `theme_preset`, …) are deliberately NOT here:
 * `config/preferences-config.ts`'s `PREFERENCE_KEYS` is already their one source of
 * truth — each key doubles as its own cookie name, `data-*` attribute, and registry key,
 * so duplicating them into this object would just be a second copy of the same string to
 * keep in sync.
 */
export const Cookies = {
  /** Set on login, cleared on logout (`lib/auth.ts`). Its value carries no information —
   * `proxy.ts`'s auth guard checks only that it exists; the real session lives server-side. */
  SESSION: "sh_session",
  /** The locale next-intl resolves from (`i18n/request.ts`). */
  LOCALE: "sh_locale",
} as const;
