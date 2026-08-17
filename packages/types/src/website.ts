/**
 * Public website CMS content — the shape the renderer reads from
 * `website_pages` / `page_sections`. See `DOCS/docs/02-architecture/website-builder.md` §2
 * and `DOCS/docs/05-database/entities/website-cms.md`.
 *
 * Only published, explicitly-publishable content ever reaches these types.
 */

/**
 * Section types shipped by theme v1 (website-builder.md §2). A theme that does not
 * implement a type simply skips it — content survives theme switches.
 */
export const SECTION_TYPES = [
  "hero",
  "about_school",
  "principal_message",
  "departments_grid",
  "teachers_grid",
  "classes_list",
  "admissions_cta",
  "events_list",
  "news_list",
  "notice_board",
  "gallery",
  "contact_form",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export function isKnownSectionType(value: string): value is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(value);
}

/**
 * A section row: ordered `type` + JSONB `props` conforming to that section's schema.
 * `props` stays `Record<string, unknown>` at the transport boundary; each section
 * component narrows it with its own Zod schema so an unexpected payload degrades
 * to "render nothing" instead of throwing.
 */
export interface PageSection {
  id: string;
  type: SectionType | (string & {});
  position: number;
  props: Record<string, unknown>;
}

export interface PageSeo {
  title?: string | null;
  description?: string | null;
  canonical_url?: string | null;
  og_image_url?: string | null;
  /** Unpublished or suspended sites emit noindex. */
  noindex?: boolean;
}

export interface WebsitePage {
  id: string;
  /** Path without a leading slash; the homepage is the empty string. */
  slug: string;
  title: string;
  seo: PageSeo;
  is_published: boolean;
  published_at: string | null;
  updated_at: string;
  sections: PageSection[];
}

export interface NavigationItem {
  label: string;
  /** Absolute path within the site, e.g. `/admissions`. */
  href: string;
  children?: NavigationItem[];
}

export interface SiteNavigation {
  primary: NavigationItem[];
  footer: NavigationItem[];
}

/** Everything needed to render chrome around any page. */
export interface SiteSettings {
  school_name: string;
  tagline?: string | null;
  logo_url?: string | null;
  social_links?: { platform: string; url: string }[];
  navigation: SiteNavigation;
}

/** Dynamic sections read live module data through dedicated public endpoints. */
export interface PublicTeacher {
  id: string;
  full_name: string;
  designation?: string | null;
  photo_url?: string | null;
  subjects?: string[];
}

export interface PublicDepartment {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
}

export interface PublicClass {
  id: string;
  name: string;
  level?: string | null;
  description?: string | null;
}

export interface PublicEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  location?: string | null;
  summary?: string | null;
  url?: string | null;
}

export interface PublicNewsPost {
  id: string;
  title: string;
  slug: string;
  published_at: string;
  excerpt?: string | null;
  cover_image_url?: string | null;
}

export interface PublicNotice {
  id: string;
  title: string;
  published_at: string;
  body?: string | null;
  attachment_url?: string | null;
}

export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
  caption?: string | null;
  width?: number;
  height?: number;
}

/** Entry in the sitemap generated per tenant from published pages. */
export interface SitemapEntry {
  path: string;
  updated_at: string;
}
