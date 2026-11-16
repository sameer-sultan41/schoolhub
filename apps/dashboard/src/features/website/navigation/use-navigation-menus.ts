"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { NAVIGATION_MENUS_RESOURCE } from "@/services/modules/website/navigation-menus/navigation-menus-constant";
import { WEBSITE_PUBLISHED_PAGES_RESOURCE } from "@/services/modules/website/website-pages/website-pages-constant";
import { WEBSITE_QUERY_MODULE } from "@/services/shared/website-content";

/** The key all three menus are read under; a save writes its menu back into it. */
export function navigationMenusKey() {
  return queryKeys.list(WEBSITE_QUERY_MODULE, NAVIGATION_MENUS_RESOURCE);
}

/** `GET /navigation-menus`: every location, an unsaved one with no items. */
export function useNavigationMenus() {
  return useQuery({
    queryKey: navigationMenusKey(),
    queryFn: () => Services.navigationMenus.fetchNavigationMenus(),
  });
}

/** The published pages a menu may link to, by title. */
export function usePublishedPages() {
  return useQuery({
    queryKey: queryKeys.list(WEBSITE_QUERY_MODULE, WEBSITE_PUBLISHED_PAGES_RESOURCE),
    queryFn: () => Services.websitePages.fetchPublishedWebsitePages(),
  });
}
