import {
  createGalleryAlbum,
  createGalleryItem,
  deleteGalleryAlbum,
  deleteGalleryItem,
  fetchGalleryAlbum,
  fetchGalleryAlbumPage,
  fetchGalleryItems,
  publishGalleryAlbum,
  reorderGalleryItems,
  unpublishGalleryAlbum,
  updateGalleryAlbum,
  updateGalleryItem,
} from "./gallery-albums-service";

export const GalleryAlbumsService = {
  fetchGalleryAlbumPage,
  fetchGalleryAlbum,
  createGalleryAlbum,
  updateGalleryAlbum,
  deleteGalleryAlbum,
  publishGalleryAlbum,
  unpublishGalleryAlbum,
  fetchGalleryItems,
  createGalleryItem,
  updateGalleryItem,
  deleteGalleryItem,
  reorderGalleryItems,
};
export type {
  GalleryAlbumInput,
  GalleryAlbumQuery,
  GalleryAlbumRecord,
  GalleryAlbumUpdateInput,
  GalleryItemInput,
  GalleryItemRecord,
  GalleryItemUpdateInput,
  GalleryMediaType,
} from "./gallery-albums-type";
