/** An origin no request ever comes from, so a resolved URL keeps it only when `next` is a path. */
const SENTINEL_ORIGIN = "https://next.invalid";

/**
 * A `next` target safe to send a signed-in user to: a single same-origin path, else `null`.
 *
 * `next` is resolved against a sentinel origin with the URL parser browsers use, and kept only if
 * the origin is unchanged. That refuses what a browser would read as another host:
 * `//evil.example`, `/\evil.example` (`\` reads as `/`), and a tab or newline smuggled between
 * the slashes (the parser strips them). The result is the parser's normalised path, query and
 * fragment, not the raw input.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next?.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(next, SENTINEL_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== SENTINEL_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
