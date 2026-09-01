/** Strips one or more trailing slashes so a base URL can be joined with a path that always
 * starts with exactly one, without ever producing a doubled "//". */
export const TRAILING_SLASH_PATTERN = /\/+$/;
