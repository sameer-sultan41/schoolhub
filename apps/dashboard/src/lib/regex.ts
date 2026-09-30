/**
 * Every regex pattern this app uses, named and documented once — the same reasoning as
 * ADR-0014's "no hardcoded values", applied to patterns instead of strings/numbers. A
 * bare `/\s+/` at a call site tells a reader nothing about what it's splitting or why;
 * `Regex.WHITESPACE` reads at the call site and still has one place to fix if it's wrong.
 */
export const Regex = {
  /** One or more whitespace chars — e.g. splitting a full name into words for initials. */
  WHITESPACE: /\s+/,
  /** A trailing `:<port>` on a hostname, e.g. the ":3000" in "demo.app.localhost:3000". */
  PORT_SUFFIX: /:\d+$/,
  /** One or more underscores — e.g. turning a snake_case value into display words.
   * Global: use with `replace`, not `test`. */
  UNDERSCORE: /_/g,
  /** A signed-URL timestamp in `YYYYMMDDTHHMMSSZ` form (AWS SigV4's `X-Amz-Date`). */
  SIGNED_AT_TIMESTAMP: /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
} as const;
