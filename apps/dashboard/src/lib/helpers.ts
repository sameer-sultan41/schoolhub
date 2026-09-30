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
