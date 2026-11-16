import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the settings, navigation and SEO tests share: each test file's
 * `jest.mock` factory reaches it through `jest.requireActual`. */
export function siteServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    files: ["uploadFile"],
    websiteSettings: ["fetchWebsiteSettings", "updateWebsiteSettings"],
    themes: ["fetchThemes"],
    websitePages: ["fetchWebsitePage", "fetchPublishedWebsitePages"],
    navigationMenus: ["fetchNavigationMenus", "updateNavigationMenu"],
    seoSettings: ["fetchSeoSetting", "updateSeoSetting"],
  });
}
