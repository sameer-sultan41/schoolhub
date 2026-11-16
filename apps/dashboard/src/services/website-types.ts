/** The type re-exports of the website CMS domains, behind `@/services` (through `./types`). */

export type { WebsiteContentQuery, WebsiteContentStatus } from "./shared/website-content";
export type {
  ContactSubmissionQuery,
  ContactSubmissionRecord,
  ContactSubmissionStatus,
} from "./modules/website/contact-submissions";
export type {
  GalleryAlbumInput,
  GalleryAlbumQuery,
  GalleryAlbumRecord,
  GalleryAlbumUpdateInput,
  GalleryItemInput,
  GalleryItemRecord,
  GalleryItemUpdateInput,
  GalleryMediaType,
} from "./modules/website/gallery-albums";
export type {
  NavigationMenuLocation,
  NavigationMenuRecord,
  NavigationTargetType,
  NavItem,
} from "./modules/website/navigation-menus";
export type {
  NewsPostDetail,
  NewsPostInput,
  NewsPostQuery,
  NewsPostRecord,
  NewsPostUpdateInput,
} from "./modules/website/news-posts";
export type {
  SchoolEventDetail,
  SchoolEventInput,
  SchoolEventQuery,
  SchoolEventRecord,
  SchoolEventUpdateInput,
} from "./modules/website/school-events";
export type {
  SeoSettingInput,
  SeoSettingRecord,
  SeoTarget,
  SeoTargetType,
} from "./modules/website/seo-settings";
export type {
  JsonSchema,
  SchemaWidget,
  ThemeRecord,
  ThemeSectionType,
} from "./modules/website/themes";
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
} from "./modules/website/website-pages";
export type {
  SocialLink,
  WebsiteSettingsInput,
  WebsiteSettingsRecord,
} from "./modules/website/website-settings";
