/**
 * Every regex pattern the app uses, in one place — same principle as utils/constants.ts:
 * one canonical location per kind of "common thing" instead of literals scattered across
 * whichever file happened to need one first.
 */
export const Regex = {
  /** Strips a trailing `:<port>` from a hostname before tenant-slug matching (lib/host.ts). */
  PORT_SUFFIX: /:\d+$/,
} as const;
