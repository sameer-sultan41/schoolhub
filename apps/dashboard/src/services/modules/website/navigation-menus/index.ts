import { fetchNavigationMenus, updateNavigationMenu } from "./navigation-menus-service";

export const NavigationMenusService = {
  fetchNavigationMenus,
  updateNavigationMenu,
};
export type {
  NavigationMenuLocation,
  NavigationMenuRecord,
  NavigationTargetType,
  NavItem,
} from "./navigation-menus-type";
