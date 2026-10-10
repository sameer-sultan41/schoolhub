/** Fallback shown wherever a tenant name would otherwise go before one is known (e.g. the
 * unauthenticated shell, or the browser tab title). */
export const PLATFORM_NAME = "SchoolHub";

/** Mirrors Tailwind's `md` breakpoint (unchanged in this repo's config). Named so a future
 * breakpoint change has one place to update instead of a silent drift between the two. */
export const TABLET_BREAKPOINT_PX = 768;

/**
 * Query cache durations. Each name reflects what the duration actually governs, even
 * where two happen to share a numeric value today (SESSION_QUERY_STALE_TIME_MS and
 * DEFAULT_QUERY_GC_TIME_MS) — coincidence, not a shared concern, so they stay separate
 * constants rather than one that would misrepresent either call site if it changed.
 */
export const DEFAULT_QUERY_STALE_TIME_MS = 30_000;
export const DEFAULT_QUERY_GC_TIME_MS = 5 * 60_000;
export const SESSION_QUERY_STALE_TIME_MS = 5 * 60_000;
export const TENANT_QUERY_STALE_TIME_MS = 10 * 60_000;

/**
 * Debounce window for every list screen's search input — long enough to skip most
 * keystrokes, short enough that the result still feels live.
 *
 * One constant rather than the per-module copies students and staff each kept: the
 * feel of a search box is a property of the app, not of the roster it happens to be
 * searching, and two constants meant two places to change it and one place to forget.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/** File types every bulk-import dialog accepts — the `accept` value for its file input,
 * matching what the importers parse server-side (`apps/api/core/imports/`). */
export const IMPORT_FILE_EXTENSIONS = ".csv,.xlsx";

/** A year: a language choice is not a session, and should outlive one. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
