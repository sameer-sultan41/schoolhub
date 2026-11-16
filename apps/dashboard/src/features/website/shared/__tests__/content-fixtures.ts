import type { Page } from "@schoolhub/types";

import {
  ApiError,
  type GalleryAlbumRecord,
  type GalleryItemRecord,
  type NewsPostDetail,
  type SchoolEventDetail,
} from "@/services";

/**
 * Records for the news, events and gallery tests, typed from the generated contract (L41), and
 * the API's own refusals in its shapes (`website_cms/errors.py::violation`: a 422 whose detail is
 * `"<reason>: <sentence>"` under the field, with `meta.reason`).
 */

export const STAMP = "2026-11-01T09:00:00Z";
export const POST_ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
export const EVENT_ID = "7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const ALBUM_ID = "8b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
export const FILE_ID = "9c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f";

export function newsPost(overrides: Partial<NewsPostDetail> = {}): NewsPostDetail {
  return {
    id: POST_ID,
    title: "Sports day results",
    slug: "sports-day-results",
    excerpt: "How every house did.",
    cover_image_file_id: null,
    status: "draft",
    published_at: null,
    locale: "",
    created_at: STAMP,
    updated_at: STAMP,
    body: { blocks: [{ type: "paragraph", text: "Blue house won." }] },
    ...overrides,
  };
}

export function schoolEvent(overrides: Partial<SchoolEventDetail> = {}): SchoolEventDetail {
  return {
    id: EVENT_ID,
    title: "Annual prize day",
    slug: "annual-prize-day",
    starts_at: "2026-12-10T05:00:00Z",
    ends_at: "2026-12-10T08:00:00Z",
    is_all_day: false,
    location: "Main hall",
    cover_image_file_id: null,
    status: "draft",
    created_at: STAMP,
    updated_at: STAMP,
    description: { blocks: [] },
    ...overrides,
  };
}

export function galleryAlbum(overrides: Partial<GalleryAlbumRecord> = {}): GalleryAlbumRecord {
  return {
    id: ALBUM_ID,
    title: "Science fair 2026",
    slug: "science-fair-2026",
    description: "",
    cover_image_file_id: null,
    school_event_id: null,
    status: "draft",
    published_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function galleryItem(overrides: Partial<GalleryItemRecord> = {}): GalleryItemRecord {
  return {
    id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    media_type: "image",
    file_id: FILE_ID,
    embed_url: "",
    caption: "",
    alt_text: "",
    position: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** One page holding `items`, as the list endpoints answer. */
export function pageOf<T>(items: T[]): Page<T> {
  return {
    items,
    pagination: { page: 1, page_size: 10, total_count: items.length, total_pages: 1 },
  };
}

/** The API's business-rule refusal (`violation(field, reason, sentence)`). */
export function violation(field: string, reason: string, sentence: string): ApiError {
  const issue = `${reason}: ${sentence}`;
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url: "/api/v1/website",
    details: [{ field, issue }],
    meta: { reason },
  });
}

/** A 422 the rich-text validator raises (keyed inside the document, no reason). */
export function documentError(field: string, issue: string): ApiError {
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url: "/api/v1/website",
    details: [{ field, issue }],
  });
}
