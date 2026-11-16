import type { NavigationMenuLocation } from "./navigation-menus-type";

/** The navigation domain's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */

export const NAVIGATION_MENUS_RESOURCE = "navigation-menus";

/** Every menu location, keyed so the compiler checks the set against the generated enum. */
const LOCATION_SET: Record<NavigationMenuLocation, true> = {
  header: true,
  footer_primary: true,
  footer_secondary: true,
};
export const NAVIGATION_MENU_LOCATIONS = Object.keys(LOCATION_SET) as NavigationMenuLocation[];
