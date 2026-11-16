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

/** One slug segment: lowercase kebab-case (website-cms plan decision 14). */
const SLUG_SEGMENT = "[a-z0-9]+(?:-[a-z0-9]+)*";

/** A news, event or album slug: exactly one segment. */
export const CONTENT_SLUG_PATTERN = new RegExp(`^${SLUG_SEGMENT}$`);

/** A CMS page path as the API returns it: `/` (the homepage) or `/<segment>[/<segment>…]`. */
export const PAGE_PATH_PATTERN = new RegExp(`^/(?:${SLUG_SEGMENT}(?:/${SLUG_SEGMENT})*)?$`);
