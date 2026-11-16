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
