/** Strips one or more trailing slashes so a base URL can be joined with a path that always
 * starts with exactly one, without ever producing a doubled "//". */
export const TRAILING_SLASH_PATTERN = /\/+$/;

/** A `Retry-After` given as delay-seconds (RFC 9110 §10.2.3), the form the API sends. */
export const DELAY_SECONDS_PATTERN = /^\d+$/;
