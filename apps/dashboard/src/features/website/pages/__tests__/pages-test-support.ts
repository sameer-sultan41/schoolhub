import { ApiError } from "@schoolhub/api-client";
import type { Page, PermissionKey } from "@schoolhub/types";

import {
  Services,
  type PageSectionRecord,
  type ThemeRecord,
  type WebsitePageDetail,
  type WebsitePageRecord,
  type WebsiteSettingsRecord,
} from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, setUrl } from "@/test-utils";

/** Shared setup for the pages tests; each file keeps its own `jest.mock` calls. */

export { rowOf, urlParam } from "@/test-fixtures/list-screen";

export const fetchPagesPage = mocked(Services.websitePages.fetchWebsitePagePage);
export const fetchPage = mocked(Services.websitePages.fetchWebsitePage);
export const createPage = mocked(Services.websitePages.createWebsitePage);
export const updatePage = mocked(Services.websitePages.updateWebsitePage);
export const deletePage = mocked(Services.websitePages.deleteWebsitePage);
export const replaceSections = mocked(Services.websitePages.replacePageSections);
export const publishPage = mocked(Services.websitePages.publishWebsitePage);
export const previewPage = mocked(Services.websitePages.previewWebsitePage);
export const fetchSettings = mocked(Services.websiteSettings.fetchWebsiteSettings);
export const fetchThemes = mocked(Services.themes.fetchThemes);
export const uploadFile = mocked(Services.files.uploadFile);
export const fetchCurrentUser = mocked(Services.auth.fetchCurrentUser);

export const PAGE_ID = "5d0c8a1e-2b3f-4c5d-8e9f-0a1b2c3d4e5f";
export const HOME_ID = "6e1d9b2f-3c4a-4d5e-9f0a-1b2c3d4e5f60";
export const HERO_ID = "7f2e0c3a-4d5b-4e6f-8a1b-2c3d4e5f6071";
export const FAQ_ID = "8a3f1d4b-5e6c-4f7a-9b2c-3d4e5f607182";
export const IMAGE_ID = "1d5c3a7e-8f9b-4c0d-9e2f-3a4b5c6d7e8f";
const STAMP = "2026-11-01T00:00:00Z";

/** Every page key a `school_owner` holds (module doc §4). */
export const PAGE_KEYS: PermissionKey[] = [
  "website.page.view",
  "website.page.create",
  "website.page.update",
  "website.page.delete",
  "website.page.publish",
];

/** Signs in with `website.page.view` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["website.page.view", ...keys]),
  );
}

export function pageRecord(overrides: Partial<WebsitePageRecord> = {}): WebsitePageRecord {
  return {
    id: PAGE_ID,
    title: "Admissions 2027",
    slug: "admissions-2027",
    page_type: "standard",
    status: "draft",
    published_at: null,
    locale: "",
    show_in_search: true,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function sectionRecord(overrides: Partial<PageSectionRecord> = {}): PageSectionRecord {
  return {
    id: HERO_ID,
    section_type: "hero",
    position: 0,
    content: { heading: "Welcome" },
    is_visible: true,
    ...overrides,
  };
}

/** A draft page with a hero and an FAQ, both visible. */
export function pageDetail(overrides: Partial<WebsitePageDetail> = {}): WebsitePageDetail {
  return {
    ...pageRecord(),
    sections: [
      sectionRecord(),
      sectionRecord({
        id: FAQ_ID,
        section_type: "faq",
        position: 1,
        content: { heading: "Questions", items: [{ question: "When?", answer: "In March." }] },
      }),
    ],
    ...overrides,
  };
}

export function pagesPage(items: WebsitePageRecord[]): Page<WebsitePageRecord> {
  return {
    items,
    pagination: {
      page: 1,
      page_size: 25,
      total_count: items.length,
      total_pages: 1,
    },
  };
}

/** The default theme's catalogue, as `GET /themes` sends it (labels in English). */
export const THEME: ThemeRecord = {
  id: "9b4a2e5c-6f7d-4a8b-9c3d-4e5f60718293",
  code: "default",
  name: "Default",
  version: "1.0.0",
  description: "",
  config_schema: {},
  section_types: {
    hero: {
      label: "Hero",
      schema: {
        type: "object",
        properties: {
          heading: { type: "string", maxLength: 200, minLength: 1, "x-widget": "text" },
          image_file_id: { type: "string", minLength: 36, maxLength: 36, "x-widget": "image" },
        },
        required: ["heading"],
      },
    },
    faq: {
      label: "FAQ",
      schema: {
        type: "object",
        properties: {
          heading: { type: "string", maxLength: 200, "x-widget": "text" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string", maxLength: 300, minLength: 1, "x-widget": "text" },
                answer: { type: "string", maxLength: 2000, minLength: 1, "x-widget": "textarea" },
              },
              required: ["question", "answer"],
            },
          },
        },
        required: ["items"],
      },
    },
    news_list: {
      label: "News",
      schema: {
        type: "object",
        properties: {
          heading: { type: "string", maxLength: 200, "x-widget": "text" },
          limit: { type: "integer", minimum: 1, maximum: 24 },
        },
      },
    },
  },
};

export const SETTINGS: WebsiteSettingsRecord = {
  exists: true,
  theme_code: "default",
  theme_version: "1.0.0",
  updated_at: STAMP,
};

/** A 422 as the API sends it: each detail under its field. */
export function refusal(details: { field: string; issue: string }[]): ApiError {
  return new ApiError({
    code: "domain_rule_violation",
    message: details[0]?.issue ?? "Invalid.",
    status: 422,
    url: "/website-pages",
    details,
  });
}

/** The `beforeEach` of every pages test: a view-only user, one draft page and the theme. */
export function stubPagesServices(url = "/website/pages") {
  jest.clearAllMocks();
  setUrl(url);
  asUser();
  fetchPagesPage.mockResolvedValue(pagesPage([pageRecord()]));
  fetchPage.mockResolvedValue(pageDetail());
  fetchSettings.mockResolvedValue(SETTINGS);
  fetchThemes.mockResolvedValue([THEME]);
}
