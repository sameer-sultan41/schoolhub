import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import type {
  NavigationMenuLocation,
  NavigationMenuRecord,
  NavItem,
} from "./navigation-menus-type";

/** The menu API calls (`/navigation-menus`), reached through `Services.navigationMenus.*`. */

/** Every location's menu; a location never saved answers with no items. */
export async function fetchNavigationMenus(): Promise<NavigationMenuRecord[]> {
  const { data } = await apiClient.get<NavigationMenuRecord[]>(endpoints.website.navigation.list);
  return data;
}

/** Replaces one location's whole item tree. */
export async function updateNavigationMenu(
  location: NavigationMenuLocation,
  items: NavItem[],
): Promise<NavigationMenuRecord> {
  const { data } = await apiClient.patch<NavigationMenuRecord>(
    endpoints.website.navigation.detail(location),
    { items },
  );
  return data;
}
