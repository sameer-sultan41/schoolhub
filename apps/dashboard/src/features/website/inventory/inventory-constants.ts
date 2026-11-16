/**
 * The content inventory's policy (module doc §13): what counts as stale, and how much of it
 * the landing lists. Declared once here.
 */

/** Content not updated for more than this many days is flagged stale. */
export const STALE_AFTER_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_MS = STALE_AFTER_DAYS * DAY_MS;

/** Only live content is flagged stale: what the public still sees. */
export const STALE_STATUS = "published";

/** How many of each kind's oldest published items the landing reads to find the stale ones. */
export const STALE_SAMPLE_SIZE = 10;

/** The kinds of content the inventory counts, in display order. */
export const INVENTORY_KINDS = ["pages", "newsPosts", "schoolEvents", "galleryAlbums"] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

/** The inventory's query-key resource suffix: its reads are derived, never a list's page. */
export const INVENTORY_RESOURCE_SUFFIX = "-inventory";
