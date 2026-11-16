import { fetchPage, MAX_PAGE_SIZE } from "@schoolhub/api-client";
import type { Page } from "@schoolhub/types";

import { apiClient } from "@/lib/auth";
import { endpoints } from "@/services/endpoints";
import { toGalleryAlbumQueryParams } from "./gallery-albums-helper";
import type {
  GalleryAlbumInput,
  GalleryAlbumQuery,
  GalleryAlbumRecord,
  GalleryAlbumUpdateInput,
  GalleryItemInput,
  GalleryItemRecord,
  GalleryItemUpdateInput,
} from "./gallery-albums-type";

/** The gallery API calls (`/gallery-albums` and an album's items), through `Services.galleryAlbums.*`. */

const paths = endpoints.website.galleryAlbums;

export async function fetchGalleryAlbumPage(
  query: GalleryAlbumQuery = {},
): Promise<Page<GalleryAlbumRecord>> {
  return fetchPage<GalleryAlbumRecord>(apiClient, paths.list, {
    query: toGalleryAlbumQueryParams(query),
  });
}

export async function fetchGalleryAlbum(id: string): Promise<GalleryAlbumRecord> {
  const { data } = await apiClient.get<GalleryAlbumRecord>(paths.detail(id));
  return data;
}

export async function createGalleryAlbum(input: GalleryAlbumInput): Promise<GalleryAlbumRecord> {
  const { data } = await apiClient.post<GalleryAlbumRecord>(paths.list, input);
  return data;
}

export async function updateGalleryAlbum(
  id: string,
  input: GalleryAlbumUpdateInput,
): Promise<GalleryAlbumRecord> {
  const { data } = await apiClient.patch<GalleryAlbumRecord>(paths.detail(id), input);
  return data;
}

export async function deleteGalleryAlbum(id: string): Promise<void> {
  await apiClient.delete(paths.detail(id));
}

export async function publishGalleryAlbum(id: string): Promise<GalleryAlbumRecord> {
  const { data } = await apiClient.post<GalleryAlbumRecord>(paths.publish(id));
  return data;
}

export async function unpublishGalleryAlbum(id: string): Promise<GalleryAlbumRecord> {
  const { data } = await apiClient.post<GalleryAlbumRecord>(paths.unpublish(id));
  return data;
}

/** An album's items in display order: one `MAX_PAGE_SIZE` page. */
export async function fetchGalleryItems(albumId: string): Promise<GalleryItemRecord[]> {
  const { items } = await fetchPage<GalleryItemRecord>(apiClient, paths.items(albumId), {
    query: { ordering: "position", page_size: MAX_PAGE_SIZE },
  });
  return items;
}

export async function createGalleryItem(
  albumId: string,
  input: GalleryItemInput,
): Promise<GalleryItemRecord> {
  const { data } = await apiClient.post<GalleryItemRecord>(paths.items(albumId), input);
  return data;
}

export async function updateGalleryItem(
  albumId: string,
  itemId: string,
  input: GalleryItemUpdateInput,
): Promise<GalleryItemRecord> {
  const { data } = await apiClient.patch<GalleryItemRecord>(paths.item(albumId, itemId), input);
  return data;
}

export async function deleteGalleryItem(albumId: string, itemId: string): Promise<void> {
  await apiClient.delete(paths.item(albumId, itemId));
}

/** Every item id of the album, in the new order; answers the reordered items. */
export async function reorderGalleryItems(
  albumId: string,
  ids: string[],
): Promise<GalleryItemRecord[]> {
  const { data } = await apiClient.patch<GalleryItemRecord[]>(paths.reorderItems(albumId), { ids });
  return data;
}
