import type { ApiSchemas } from "@schoolhub/api-client";

import type { WebsiteContentQuery } from "@/services/shared/website-content";

/** The generated wire shapes (ADR-0017). */
export type GalleryAlbumRecord = ApiSchemas["GalleryAlbum"];
export type GalleryAlbumInput = ApiSchemas["GalleryAlbumWrite"];
export type GalleryAlbumUpdateInput = ApiSchemas["PatchedGalleryAlbumWrite"];
export type GalleryItemRecord = ApiSchemas["GalleryItem"];
export type GalleryItemInput = ApiSchemas["GalleryItemWrite"];
export type GalleryItemUpdateInput = ApiSchemas["PatchedGalleryItemWrite"];
export type GalleryMediaType = ApiSchemas["GalleryMediaTypeEnum"];

export interface GalleryAlbumQuery extends WebsiteContentQuery {
  schoolEventId?: string;
}
