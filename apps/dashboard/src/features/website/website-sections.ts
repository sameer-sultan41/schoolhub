import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

/**
 * The one list of Website sections, in tab order: the tabs, the `/website` landing and the
 * sidebar's children all derive from it (decision 12a). Each section is gated on the key its
 * screen needs, and ships with its screen. Navigation, settings and SEO are gated on their own
 * update keys, so a site admin (`it_admin`) reaches them without reading content; the group shows
 * when any section is visible.
 */
export const WEBSITE_SECTIONS = [
  {
    href: Paths.WEBSITE,
    labelKey: "nav.overview",
    menuTitle: "Overview",
    permission: "website.page.view",
  },
  {
    href: Paths.WEBSITE_PAGES,
    labelKey: "nav.pages",
    menuTitle: "Pages",
    permission: "website.page.view",
  },
  {
    href: Paths.WEBSITE_NEWS,
    labelKey: "nav.news",
    menuTitle: "News",
    permission: "website.page.view",
  },
  {
    href: Paths.WEBSITE_EVENTS,
    labelKey: "nav.events",
    menuTitle: "Events",
    permission: "website.page.view",
  },
  {
    href: Paths.WEBSITE_GALLERY,
    labelKey: "nav.gallery",
    menuTitle: "Gallery",
    permission: "website.page.view",
  },
  {
    href: Paths.WEBSITE_NAVIGATION,
    labelKey: "nav.navigation",
    menuTitle: "Navigation",
    permission: "website.navigation.update",
  },
  {
    href: Paths.WEBSITE_SETTINGS,
    labelKey: "nav.settings",
    menuTitle: "Settings",
    permission: "website.settings.update",
  },
  {
    href: Paths.WEBSITE_SEO,
    labelKey: "nav.seo",
    menuTitle: "SEO",
    permission: "website.seo.update",
  },
] as const satisfies readonly ModuleSection[];
