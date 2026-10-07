import { format, formatDistanceToNow, parseISO } from "date-fns";
import { enUS } from "date-fns/locale";
import type { Locale } from "date-fns";
import { isSupportedLocale, type SupportedLocale } from "./env";
import { Regex } from "./regex";

/**
 * Small, generic helpers shared across modules — the one intentional exception to this
 * `lib/` directory's usual one-file-per-concern convention (`host.ts`, `stable-signed-url.ts`,
 * `query-client.ts`, …). A helper earns a place here only once it's generic (not tied to
 * one module's domain, e.g. staff) and used in more than one place; a module-specific one
 * belongs next to that module instead.
 */

/**
 * First + last initial from a full name, e.g. "Jane Doe" -> "JD". Falls back to the
 * first two letters of a single-word name, or "?" for an empty/whitespace-only one.
 *
 * Generic, not staff-specific: renders the initials fallback for whichever user is
 * signed in (`shell/partials/topbar/user-dropdown-menu.tsx`) as much as for a staff
 * record's own avatar (`staff/staff-directory-table.tsx`, `staff-detail-sheet.tsx`,
 * `staff-form-dialog.tsx`) — what shows while a photo loads, and whenever it fails to
 * (an expired link, a deleted object).
 */
export function getInitials(name: string): string {
  const [first, ...rest] = name.trim().split(Regex.WHITESPACE).filter(Boolean);
  if (!first) return "?";
  const last = rest.at(-1);
  return last ? `${first[0]}${last[0]}`.toUpperCase() : first.slice(0, 2).toUpperCase();
}

/**
 * Keeps one signed storage link per object while it is still comfortably valid.
 *
 * Every API response signs photo links afresh (a new `X-Amz-Date`, so a new URL), which
 * would swap every avatar's `src` on each refetch: Radix Avatar unmounts the image while
 * the new URL loads — a blink to initials — and the browser cache, keyed by the full URL,
 * misses and downloads the photo again. Returning the link already in use for the same
 * object avoids both until it nears expiry.
 *
 * Generic, not staff-specific: called for the signed-in user's own avatar
 * (`shell/partials/topbar/user-dropdown-menu.tsx`) as much as for a staff record's
 * (`staff/staff-directory-table.tsx`, `staff-form-dialog.tsx`).
 */

/** Adopt a fresh link once the one in use has less than this left. */
const MIN_REMAINING_MS = 5 * 60_000;

/** `origin + path` (the object) → the signed link currently in use for it. */
const inUse = new Map<string, string>();

/** When a SigV4 link stops working, or `null` if it isn't one (e.g. a test placeholder). */
function expiresAt(url: URL): number | null {
  const signedAt = url.searchParams.get("X-Amz-Date"); // e.g. 20260924T180939Z
  const ttlSeconds = Number(url.searchParams.get("X-Amz-Expires"));
  const parts = signedAt?.match(Regex.SIGNED_AT_TIMESTAMP);
  if (!parts || !Number.isFinite(ttlSeconds)) return null;
  // The regex guarantees all six groups; the defaults only satisfy noUncheckedIndexedAccess.
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = parts
    .slice(1)
    .map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second) + ttlSeconds * 1000;
}

/** Drops every entry whose cached link has already crossed the same "adopt fresh"
 * threshold a lookup would — an object nobody has asked about in a while (a photo
 * removed from view, a staff member no longer in any loaded page) never gets its own
 * removal path, so each call opportunistically sweeps rather than only ever growing. */
function evictStale(now: number): void {
  for (const [object, url] of inUse) {
    const expiry = expiresAt(new URL(url));
    if (expiry !== null && expiry - now <= MIN_REMAINING_MS) inUse.delete(object);
  }
}

export function stableSignedUrl(url: string | null, now: number = Date.now()): string | null {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  evictStale(now);
  const object = `${parsed.origin}${parsed.pathname}`;
  const previous = inUse.get(object);
  if (previous) {
    const previousExpiry = expiresAt(new URL(previous));
    if (previousExpiry !== null && previousExpiry - now > MIN_REMAINING_MS) return previous;
  }
  inUse.set(object, url);
  return url;
}

/** "3 days ago" rather than a raw ISO timestamp. Shared by students and staff, each of
 * which renders a record's `updated_at` this way on its own detail view/directory row. */
export function formatLastUpdated(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDistanceToNow(parsed, { addSuffix: true });
}

/** date-fns' own `Locale` object for each locale this app ships. date-fns has no Urdu
 * locale at all (`date-fns/locale` exports no `ur`), so `ur` falls back to `enUS` —
 * that only changes which language month/day names and relative-time phrasing render
 * in, never which calendar date or instant is computed. */
const DATE_FNS_LOCALES: Record<SupportedLocale, Locale> = {
  en: enUS,
  ur: enUS,
};

/** Resolves a next-intl locale (e.g. `useLocale()`) to date-fns' own `Locale` object,
 * so `formatDate` can render in the viewer's language instead of always defaulting to
 * English regardless of the active locale. Falls back to `enUS` for anything this app
 * doesn't ship (including no locale at all). */
function resolveDateFnsLocale(locale: string): Locale {
  return isSupportedLocale(locale) ? DATE_FNS_LOCALES[locale] : enUS;
}

/** A longer, absolute rendering ("January 5, 2026") — distinct from `formatLastUpdated`'s
 * relative one. Used for a fixed date that should read as a calendar date, not an elapsed
 * time (a staff member's joining date/date of birth; a document's expiry date).
 *
 * Takes the viewer's locale (e.g. from `useLocale()`) so the month name renders in their
 * language rather than always English — a caller with no locale context gets "en".
 *
 * Parses with `parseISO`, not `new Date()`: a date-only field (a `DateField` like a
 * document's `expires_at`, e.g. "2026-01-05", with no time or timezone component) has no
 * real instant to anchor to, but `new Date()` still treats the bare string as UTC
 * midnight per the ECMA-262 Date Time String Format — `format()` then renders that UTC
 * instant in the browser's LOCAL zone, which reads one calendar day early for every
 * viewer west of UTC (the Americas). `parseISO` parses the same date-only string as LOCAL
 * midnight instead, which is the correct reading for a field with no time of its own. */
export function formatDate(value: string, locale: string = "en"): string {
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : format(parsed, "PPP", { locale: resolveDateFnsLocale(locale) });
}

/** Humanizes an unlabelled snake_case value, e.g. "on_leave" -> "On leave". Shared by
 * staff (employment fields) and available to any future module with the same need. */
export function humanizeSnakeCase(value: string): string {
  const spaced = value.replace(Regex.UNDERSCORE, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Copies `from[camelKey]` to `to[snakeKey]` for each pair in `fields`, when
 * `include(value)` says to — the shape a module's `to<Domain>Body`/
 * `to<Domain>QueryParams` helpers need, just with a different `include` predicate and
 * field list each. `to` is mutated in place so a caller can seed it with
 * always-present fields first.
 */
export function copyMappedFields<T extends object>(
  from: T,
  fields: ReadonlyArray<readonly [keyof T, string]>,
  include: (value: T[keyof T]) => boolean,
  to: Record<string, unknown>,
): void {
  for (const [camelKey, snakeKey] of fields) {
    const value = from[camelKey];
    if (include(value)) to[snakeKey] = value;
  }
}
