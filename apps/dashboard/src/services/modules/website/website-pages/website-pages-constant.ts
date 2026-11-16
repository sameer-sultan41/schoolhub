import type { SortingState } from "@tanstack/react-table";

import { FILTER_ALL } from "@/lib/constants";
import { WEBSITE_CONTENT_STATUSES } from "@/services/shared/website-content";
import type { SectionType, WebsitePageType } from "./website-pages-type";

/** The pages domain's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */

export const WEBSITE_PAGES_RESOURCE = "pages";
/** One page's detail (its sections included), under the same module. */
export const WEBSITE_PAGE_DETAIL_RESOURCE = "page";

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

/** The site's one home page, served at `/`; the API refuses a second (`home_exists`). */
export const HOME_PAGE_TYPE: WebsitePageType = "home";
/** The home page's own address; no other page may take it. */
export const HOME_PAGE_SLUG = "home";
/** What a new page is unless the form says otherwise (the serializer's default). */
export const DEFAULT_PAGE_TYPE: WebsitePageType = "standard";
/** The types a new page may take: every type but the home page's. */
export const CREATABLE_PAGE_TYPES = WEBSITE_PAGE_TYPES.filter((type) => type !== HOME_PAGE_TYPE);

/** `PAGE_SLUG_MAX_LENGTH` (`apps/api/apps/website_cms/constants.py`). */
export const PAGE_SLUG_MAX_LENGTH = 120;
/** `WebsitePage.title`'s `max_length`. */
export const PAGE_TITLE_MAX_LENGTH = 200;
/** `MAX_SECTIONS_PER_PAGE` (`apps/api/apps/website_cms/constants.py`). */
export const MAX_SECTIONS_PER_PAGE = 50;

/** Every section type, keyed so the compiler checks the set against the generated enum. A theme
 * type outside it can't be saved (the API refuses it), so it is never offered. */
const SECTION_TYPE_SET: Record<SectionType, true> = {
  hero: true,
  about_school: true,
  principal_message: true,
  departments_grid: true,
  teachers_grid: true,
  classes_list: true,
  admissions_cta: true,
  events_list: true,
  news_list: true,
  notice_board: true,
  gallery: true,
  contact_form: true,
  rich_text: true,
  faq: true,
};

export function isSectionType(value: string): value is SectionType {
  return Object.hasOwn(SECTION_TYPE_SET, value);
}

/** The directory's column ids that sort, and the API field each sorts by (`ordering_fields`). */
export const PAGES_SORT_FIELD: Readonly<Record<string, string>> = {
  title: "title",
  slug: "slug",
  page_type: "page_type",
  status: "status",
  updated_at: "updated_at",
};
export const PAGES_SORTABLE_IDS = Object.keys(PAGES_SORT_FIELD);
/** The API's own default order (`ordering = ["slug", "id"]`). */
export const PAGES_DEFAULT_SORTING: SortingState = [{ id: "slug", desc: false }];
export const PAGES_ACTIONS_COLUMN_ID = "actions";

const STATUS_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...WEBSITE_CONTENT_STATUSES];
const TYPE_FILTER_VALUES: readonly string[] = [FILTER_ALL, ...WEBSITE_PAGE_TYPES];

/** The directory's URL filters (`useDataGridUrlState`): every status, every type. */
export const PAGES_URL_FILTERS = {
  status: { default: FILTER_ALL, isValid: (value: string) => STATUS_FILTER_VALUES.includes(value) },
  type: { default: FILTER_ALL, isValid: (value: string) => TYPE_FILTER_VALUES.includes(value) },
};

/** The fields a server error may name on the page details form. */
export const PAGE_ERROR_FIELDS = ["title", "slug", "page_type", "show_in_search"] as const;
