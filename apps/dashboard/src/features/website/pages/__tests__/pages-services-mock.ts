import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the pages tests share: each test file's `jest.mock` factory reaches it
 * through `jest.requireActual`. */
export function pagesServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    websitePages: [
      "fetchWebsitePagePage",
      "fetchWebsitePage",
      "createWebsitePage",
      "updateWebsitePage",
      "deleteWebsitePage",
      "replacePageSections",
      "publishWebsitePage",
      "unpublishWebsitePage",
      "archiveWebsitePage",
      "previewWebsitePage",
    ],
    websiteSettings: ["fetchWebsiteSettings"],
    themes: ["fetchThemes"],
  });
}
