// Reads the request's cookies: a client-component import must fail the build.
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * Page preview (website-cms plan decision 9, ADR-0039).
 *
 * `/api/preview` validates a dashboard preview token against the API, then keeps it in this
 * httpOnly cookie: the cookie is the only switch. Next's Draft Mode is not used, because its
 * `__prerender_bypass` cookie is one value for the whole build and so would work on every
 * school's host. While the cookie is held, `pages` and `site` reads send the token as
 * `X-Preview-Token`, uncached; every other read stays the cached public one. The API decides what
 * a token may read, so a forged or expired cookie only falls back to the published read, and the banner shows
 * only for a render whose page the API served as a preview.
 */

export const PREVIEW_COOKIE = "schoolhub_preview";
/** The header the API reads a preview token from; never a query parameter (SEC-57). */
export const PREVIEW_HEADER = "X-Preview-Token";
/** Response header: whole seconds the API will still accept the token. */
export const PREVIEW_EXPIRES_HEADER = "X-Preview-Expires-In";
const WHOLE_NUMBER_PATTERN = /^\d+$/;
/** Comfortably above a signed `tenant_id:page_id` token; anything longer is not one. */
export const PREVIEW_TOKEN_MAX_LENGTH = 512;

/** The cookie's attributes, shared by the route that sets it and the one that clears it. */
export const PREVIEW_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

/**
 * The cookie's `maxAge`: the whole seconds the API says the token has left, so the cookie never
 * outlives it and no clock is compared. `null` when the header is missing, not a whole number
 * or 0 (set no cookie).
 */
export function previewMaxAgeSeconds(expiresIn: string | null): number | null {
  if (!expiresIn || !WHOLE_NUMBER_PATTERN.test(expiresIn)) return null;
  const seconds = Number(expiresIn);
  return seconds > 0 ? seconds : null;
}

/** Per-request flag: did this render's page come from a preview read (not the published fallback)? */
const previewServed = cache(() => ({ current: false }));

export function markPreviewServed(): void {
  previewServed().current = true;
}

export function isPreviewServed(): boolean {
  return previewServed().current;
}

/** The preview cookie's token, or null when there is none or it cannot be a token. */
export const getPreviewToken = cache(async (): Promise<string | null> => {
  const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  return token && token.length <= PREVIEW_TOKEN_MAX_LENGTH ? token : null;
});
