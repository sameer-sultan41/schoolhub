import type { QueryParams } from "@schoolhub/api-client";

import { toContentQueryParams } from "@/services/shared/website-content";
import type { GalleryAlbumQuery } from "./gallery-albums-type";

/** The albums list's query string: the shared content filters plus the linked event. */
export function toGalleryAlbumQueryParams(query: GalleryAlbumQuery): QueryParams {
  return toContentQueryParams(query, { school_event_id: query.schoolEventId });
}
