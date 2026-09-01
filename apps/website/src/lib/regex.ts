/** Strips one or more trailing slashes so a base URL can be joined with a path that always
 * starts with exactly one, without ever producing a doubled "//". */
export const TRAILING_SLASH_PATTERN = /\/+$/;

/** Strips an explicit port from a Host header value, e.g. "cityschool.schoolhub.pk:3001"
 * -> "cityschool.schoolhub.pk". */
export const PORT_SUFFIX_PATTERN = /:\d+$/;

/** Strips a trailing dot from a fully-qualified Host header value. */
export const TRAILING_DOT_PATTERN = /\.$/;

/** Rejects a normalized Host header value that is not a plausible hostname before it
 * reaches an API URL. */
export const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/;

/** Strips the "sha256=" scheme prefix HMAC signature headers are conventionally sent with. */
export const SHA256_PREFIX_PATTERN = /^sha256=/;
