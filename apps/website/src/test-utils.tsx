import type { ApiSchemas } from "@schoolhub/api-client";

type PublicTenant = ApiSchemas["PublicTenant"];
type PublicSection = ApiSchemas["PublicSection"];
type PublicPage = ApiSchemas["PublicPage"];
type PublicSite = ApiSchemas["PublicSite"];

export const TEST_HOST = "cityschool.schoolhub.pk";

const EMPTY_BRANDING: ApiSchemas["PublicBranding"] = {
  primary_color: null,
  secondary_color: null,
  accent_color: null,
  background_color: null,
  foreground_color: null,
  heading_font: null,
  body_font: null,
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  radius: null,
};

export function makeBranding(
  overrides: Partial<ApiSchemas["PublicBranding"]> = {},
): ApiSchemas["PublicBranding"] {
  return { ...EMPTY_BRANDING, ...overrides };
}

export function makeTenant(overrides: Partial<PublicTenant> = {}): PublicTenant {
  return {
    id: "t1",
    slug: "cityschool",
    name: "City School",
    status: "active",
    website_status: "live",
    branding: EMPTY_BRANDING,
    locale: {
      default_locale: "en",
      enabled_locales: ["en"],
      timezone: "Asia/Karachi",
      direction: "ltr",
    },
    contact: null,
    custom_domain: null,
    enabled_modules: [],
    ...overrides,
  };
}

export function makeContact(
  overrides: Partial<ApiSchemas["PublicTenantContact"]> = {},
): ApiSchemas["PublicTenantContact"] {
  return { campus_name: "Main campus", address: "", phone: "", email: "", ...overrides };
}

export function makeSection(
  props: Record<string, unknown> = {},
  overrides: Partial<PublicSection> = {},
): PublicSection {
  return { id: "s1", type: "hero", position: 0, props, ...overrides };
}

/** The props every section component receives, around one section. */
export function sectionProps(props: Record<string, unknown> = {}, tenant = makeTenant()) {
  return { section: makeSection(props), tenant, host: TEST_HOST, pageId: "p1" };
}

export function makePage(overrides: Partial<PublicPage> = {}): PublicPage {
  return {
    id: "p1",
    slug: "",
    path: "/",
    title: "Home",
    page_type: "home",
    status: "published",
    is_homepage: true,
    published_at: "2027-01-01T00:00:00Z",
    updated_at: "2027-01-01T00:00:00Z",
    sections: [],
    seo: {
      title: null,
      description: null,
      canonical_url: null,
      og_image_url: null,
      robots: null,
      noindex: false,
    },
    ...overrides,
  };
}

export function makeSite(overrides: Partial<PublicSite> = {}): PublicSite {
  return {
    theme: { code: "default", version: "1.0.0", config: {} },
    navigation: { header: [], footer_primary: [], footer_secondary: [] },
    header_config: {},
    footer_config: {},
    social_links: [],
    seo: {
      title: null,
      description: null,
      canonical_url: null,
      og_image_url: null,
      robots: null,
      noindex: false,
    },
    ...overrides,
  };
}

export function makeNewsPostDetail(
  overrides: Partial<ApiSchemas["PublicNewsPostDetail"]> = {},
): ApiSchemas["PublicNewsPostDetail"] {
  return {
    id: "n1",
    slug: "sports-day",
    title: "Sports day",
    excerpt: "A day of races.",
    cover_image_url: null,
    published_at: "2027-03-01T05:00:00Z",
    body: { blocks: [{ type: "paragraph", text: "Every house took part." }] },
    updated_at: "2027-03-02T05:00:00Z",
    ...overrides,
  };
}

export function makeEventDetail(
  overrides: Partial<ApiSchemas["PublicSchoolEventDetail"]> = {},
): ApiSchemas["PublicSchoolEventDetail"] {
  return {
    id: "e1",
    slug: "annual-day",
    title: "Annual day",
    starts_at: "2027-04-12T04:00:00Z",
    ends_at: null,
    is_all_day: false,
    location: "Main hall",
    cover_image_url: null,
    description: { blocks: [{ type: "paragraph", text: "Parents are welcome." }] },
    updated_at: "2027-03-02T05:00:00Z",
    ...overrides,
  };
}

export function makeAlbumDetail(
  overrides: Partial<ApiSchemas["PublicGalleryAlbumDetail"]> = {},
): ApiSchemas["PublicGalleryAlbumDetail"] {
  return {
    id: "a1",
    slug: "science-fair",
    title: "Science fair",
    description: "",
    cover_image_url: null,
    published_at: "2027-03-01T05:00:00Z",
    item_count: 0,
    items: [],
    ...overrides,
  };
}

export function makeGalleryItem(
  overrides: Partial<ApiSchemas["PublicGalleryItem"]> = {},
): ApiSchemas["PublicGalleryItem"] {
  return {
    id: "i1",
    media_type: "image",
    image_url: "https://api.test.invalid/api/v1/public/files/t1/f1",
    embed_url: null,
    caption: "",
    alt_text: "A volcano model",
    position: 0,
    ...overrides,
  };
}
