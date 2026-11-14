/** The Grants page's sub-tab ids, as `?tab=` carries them. Discounts is first, so it is the default and leaves the key out. */
export const DISCOUNTS_TAB_ID = "discounts";
export const SCHOLARSHIPS_TAB_ID = "scholarships";
export const FINES_TAB_ID = "fines";

/** The URL keys every grants list owns (its status and student filters), cleared on a tab change. */
export const GRANT_URL_FILTER_KEYS = ["status", "student"] as const;
