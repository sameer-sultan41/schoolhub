import type { WebsiteContentStatus } from "@/services/shared/website-content";
import type { GalleryMediaType } from "./gallery-albums-type";

/** The gallery domain's constants. Reads live under `WEBSITE_QUERY_MODULE` (`website-content.ts`). */
export const GALLERY_ALBUMS_RESOURCE = "gallery-albums";

/** The public website path a slug of this kind sits under (the renderer's route). */
export const GALLERY_PATH_PREFIX = "/gallery/";
export const GALLERY_ITEMS_RESOURCE = "gallery-items";

/** The statuses an album can be in: the API has no `:archive` for albums. */
export const ALBUM_STATUSES: readonly WebsiteContentStatus[] = ["draft", "published"];

/** Sortable column id -> `GalleryAlbumViewSet.ordering_fields`. */
export const ALBUM_SORT_FIELD: Readonly<Record<string, string>> = {
  title: "title",
  status: "status",
  published_at: "published_at",
  updated_at: "updated_at",
};

/** `GalleryItem` column lengths (`website_cms/models.py`). */
export const GALLERY_CAPTION_MAX = 300;
export const GALLERY_ALT_TEXT_MAX = 300;
/** `website_cms/constants.py::EMBED_URL_MAX_LENGTH`. The allowed video hosts are the server's
 * (`EMBED_HOSTS`), checked there alone so the two lists cannot drift. */
export const GALLERY_EMBED_URL_MAX = 500;

export const GALLERY_MEDIA_IMAGE: GalleryMediaType = "image";
export const GALLERY_MEDIA_VIDEO: GalleryMediaType = "video_embed";
