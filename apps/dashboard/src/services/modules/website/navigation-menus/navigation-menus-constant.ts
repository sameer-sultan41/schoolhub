import type { NavigationMenuLocation, NavigationTargetType } from "./navigation-menus-type";

/** The navigation domain's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */

export const NAVIGATION_MENUS_RESOURCE = "navigation-menus";

/** Every menu location, keyed so the compiler checks the set against the generated enum. */
const LOCATION_SET: Record<NavigationMenuLocation, true> = {
  header: true,
  footer_primary: true,
  footer_secondary: true,
};
export const NAVIGATION_MENU_LOCATIONS = Object.keys(LOCATION_SET) as NavigationMenuLocation[];

/** Every link target type, keyed the same way. */
const TARGET_TYPE_SET: Record<NavigationTargetType, true> = {
  page: true,
  url: true,
  news_index: true,
  events_index: true,
  gallery_index: true,
};
export const NAVIGATION_TARGET_TYPES = Object.keys(TARGET_TYPE_SET) as NavigationTargetType[];

/** The target types that carry a `target`: a page id, or a link. The index types take none. */
export const NAV_PAGE_TARGET: NavigationTargetType = "page";
export const NAV_URL_TARGET: NavigationTargetType = "url";

/** The menu rules `website_cms/constants.py` declares (module doc §11). */
export const NAV_LABEL_MAX = 60;
export const NAV_MAX_ITEMS = 50;
/** A top-level item and its children: an item holding children can't itself be nested. */
export const NAV_MAX_DEPTH = 2;
