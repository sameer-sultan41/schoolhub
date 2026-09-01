/** Route the app treats as the sign-in destination — checked by proxy.ts's public-path
 * allowlist and used as the redirect target after logout or a lost session. */
export const LOGIN_PATH = "/login";

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
