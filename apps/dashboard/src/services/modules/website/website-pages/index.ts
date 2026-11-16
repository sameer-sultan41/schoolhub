import {
  archiveWebsitePage,
  createWebsitePage,
  deleteWebsitePage,
  fetchWebsitePage,
  fetchWebsitePagePage,
  previewWebsitePage,
  publishWebsitePage,
  replacePageSections,
  unpublishWebsitePage,
  updateWebsitePage,
} from "./website-pages-service";

export const WebsitePagesService = {
  fetchWebsitePagePage,
  fetchWebsitePage,
  createWebsitePage,
  updateWebsitePage,
  deleteWebsitePage,
  replacePageSections,
  publishWebsitePage,
  unpublishWebsitePage,
  archiveWebsitePage,
  previewWebsitePage,
};
export type {
  PagePreview,
  PageSectionInput,
  PageSectionRecord,
  SectionType,
  WebsitePageCreateInput,
  WebsitePageDetail,
  WebsitePageQuery,
  WebsitePageRecord,
  WebsitePageType,
  WebsitePageUpdateInput,
} from "./website-pages-type";
