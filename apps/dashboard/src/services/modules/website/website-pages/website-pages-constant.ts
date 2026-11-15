import type { WebsitePageType } from "./website-pages-type";

/** The pages domain's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */

export const WEBSITE_PAGES_RESOURCE = "pages";

/** Every page type, keyed so the compiler checks the set against the generated enum. */
const PAGE_TYPE_SET: Record<WebsitePageType, true> = {
  home: true,
  about: true,
  principal_message: true,
  departments: true,
  teachers: true,
  classes: true,
  admissions: true,
  contact: true,
  standard: true,
};
export const WEBSITE_PAGE_TYPES = Object.keys(PAGE_TYPE_SET) as WebsitePageType[];
