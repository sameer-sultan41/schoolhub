/**
 * Keeps one signed storage link per object while it is still comfortably valid.
 *
 * Every API response signs photo links afresh (a new `X-Amz-Date`, so a new URL), which
 * would swap every avatar's `src` on each refetch: Radix Avatar unmounts the image while
 * the new URL loads — a blink to initials — and the browser cache, keyed by the full URL,
 * misses and downloads the photo again. Returning the link already in use for the same
 * object avoids both until it nears expiry.
 */

/** Adopt a fresh link once the one in use has less than this left. */
const MIN_REMAINING_MS = 5 * 60_000;

/** `origin + path` (the object) → the signed link currently in use for it. */
const inUse = new Map<string, string>();

/** When a SigV4 link stops working, or `null` if it isn't one (e.g. a test placeholder). */
function expiresAt(url: URL): number | null {
  const signedAt = url.searchParams.get("X-Amz-Date"); // e.g. 20260924T180939Z
  const ttlSeconds = Number(url.searchParams.get("X-Amz-Expires"));
  const parts = signedAt?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
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
