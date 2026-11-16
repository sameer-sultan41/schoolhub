import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

/**
 * The one list of Website sections, in tab order: the tabs, the `/website` landing and the
 * sidebar's children all derive from it (decision 12a). Each section is gated on the key its
 * screen needs, and ships with its screen: news, events and gallery join in PR G; settings,
 * navigation, SEO, domains and the contact inbox in PR H.
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
] as const satisfies readonly ModuleSection[];
