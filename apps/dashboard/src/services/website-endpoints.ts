/**
 * The website-cms paths, read through `endpoints.website` (`./endpoints.ts`). Kept in their own
 * file so `endpoints.ts` stays under the 400-line cap. Colon-actions (`:publish`) are part of the
 * registered route, not nested paths. Every read needs `website.page.view` (module doc §4).
 */

const pages = "/website-pages";
const newsPosts = "/news-posts";
const schoolEvents = "/school-events";
const galleryAlbums = "/gallery-albums";

export const websiteEndpoints = {
  /** `GET` (an unsaved default with `exists: false` before the first save) and `PATCH`. */
  settings: "/website-settings",
  themes: "/themes",
  pages: {
    list: pages,
    detail: (id: string) => `${pages}/${id}`,
    /** `PATCH` replaces every section of the page in one write. */
    sections: (id: string) => `${pages}/${id}/page-sections`,
    publish: (id: string) => `${pages}/${id}:publish`,
    unpublish: (id: string) => `${pages}/${id}:unpublish`,
    archive: (id: string) => `${pages}/${id}:archive`,
    preview: (id: string) => `${pages}/${id}:preview`,
  },
  navigation: {
    list: "/navigation-menus",
    detail: (location: string) => `/navigation-menus/${location}`,
  },
  /** One row per target, addressed by `?target_type=&target_id=`. */
  seo: "/seo-settings",
  newsPosts: {
    list: newsPosts,
    detail: (id: string) => `${newsPosts}/${id}`,
    publish: (id: string) => `${newsPosts}/${id}:publish`,
    unpublish: (id: string) => `${newsPosts}/${id}:unpublish`,
    archive: (id: string) => `${newsPosts}/${id}:archive`,
  },
  schoolEvents: {
    list: schoolEvents,
    detail: (id: string) => `${schoolEvents}/${id}`,
    publish: (id: string) => `${schoolEvents}/${id}:publish`,
    unpublish: (id: string) => `${schoolEvents}/${id}:unpublish`,
    archive: (id: string) => `${schoolEvents}/${id}:archive`,
  },
  /** Item writes need `website.gallery-album.update`; albums have no `:archive`. */
  galleryAlbums: {
    list: galleryAlbums,
    detail: (id: string) => `${galleryAlbums}/${id}`,
    publish: (id: string) => `${galleryAlbums}/${id}:publish`,
    unpublish: (id: string) => `${galleryAlbums}/${id}:unpublish`,
    items: (id: string) => `${galleryAlbums}/${id}/gallery-items`,
    item: (id: string, itemId: string) => `${galleryAlbums}/${id}/gallery-items/${itemId}`,
    reorderItems: (id: string) => `${galleryAlbums}/${id}/gallery-items:reorder`,
  },
  /** Read with `website.contact-submission.view`, triaged (`PATCH` status) with `.update`. */
  contactSubmissions: {
    list: "/contact-submissions",
    detail: (id: string) => `/contact-submissions/${id}`,
  },
} as const;
