// Reads the request's cookies: a client-component import must fail the build.
import "server-only";
import { cookies, draftMode } from "next/headers";
import { cache } from "react";

/**
 * Page preview (website-cms plan decision 9, ADR-0039).
 *
 * `/api/preview` validates a dashboard preview token against the API, then enables Draft Mode and
 * keeps the token in this cookie. While Draft Mode is on, `pages` and `site` reads send it as
 * `X-Preview-Token`, uncached; every other read stays the public one.
 */

export const PREVIEW_COOKIE = "schoolhub_preview";
/** The header the API reads a preview token from; never a query parameter (SEC-57). */
export const PREVIEW_HEADER = "X-Preview-Token";
/** The token's own lifetime (`TimestampSigner` `max_age`), so the cookie never outlives it. */
export const PREVIEW_MAX_AGE_SECONDS = 600;

/** The cookie's attributes, shared by the route that sets it and the one that clears it. */
export const PREVIEW_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

/** The preview token for this request, or null outside Draft Mode or once the cookie expired. */
export const getPreviewToken = cache(async (): Promise<string | null> => {
  const { isEnabled } = await draftMode();
  if (!isEnabled) return null;
  return (await cookies()).get(PREVIEW_COOKIE)?.value || null;
});
