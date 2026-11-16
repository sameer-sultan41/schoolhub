import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the news, events and gallery tests share: each test file's `jest.mock`
 * factory reaches it through `jest.requireActual`. */
export function contentServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    files: ["uploadFile"],
    newsPosts: [
      "fetchNewsPostPage",
      "fetchNewsPost",
      "createNewsPost",
      "updateNewsPost",
      "deleteNewsPost",
      "publishNewsPost",
      "unpublishNewsPost",
      "archiveNewsPost",
    ],
    schoolEvents: [
      "fetchSchoolEventPage",
      "fetchSchoolEvent",
      "createSchoolEvent",
      "updateSchoolEvent",
      "publishSchoolEvent",
      "unpublishSchoolEvent",
      "archiveSchoolEvent",
    ],
    galleryAlbums: [
      "fetchGalleryAlbumPage",
      "fetchGalleryAlbum",
      "createGalleryAlbum",
      "updateGalleryAlbum",
      "deleteGalleryAlbum",
      "publishGalleryAlbum",
      "unpublishGalleryAlbum",
      "fetchGalleryItems",
      "createGalleryItem",
      "updateGalleryItem",
      "deleteGalleryItem",
      "reorderGalleryItems",
    ],
  });
}
