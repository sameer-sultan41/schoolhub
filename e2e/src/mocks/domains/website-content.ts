import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, noContent, ok, type MockResponse } from "../envelope";
import { pageOf } from "../list";
import type { MockModule, MockRequest } from "../router";
import { refuse } from "./website";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a status, a position). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time (L41). */
export type NewsPost = Writable<ApiSchemas["NewsPostDetail"]>;
export type SchoolEvent = Writable<ApiSchemas["SchoolEventDetail"]>;
export type GalleryAlbum = Writable<ApiSchemas["GalleryAlbum"]>;
export type GalleryItem = Writable<ApiSchemas["GalleryItem"]> & { gallery_album_id: string };

const STAMP = "2026-11-01T09:00:00Z";
const ACTED_AT = "2026-11-15T10:00:00Z";
/** `website_cms/constants.py`: `CONTENT_SLUG_PATTERN`, `EMBED_URL_MAX_LENGTH`, `EMBED_HOSTS`. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMBED_URL_MAX = 500;
const EMBED_HOSTS = ["www.youtube.com", "youtube.com", "youtu.be", "player.vimeo.com", "vimeo.com"];

export function buildNewsPost(overrides: Partial<NewsPost> = {}): NewsPost {
  return {
    id: uuid(),
    title: "Sports day results",
    slug: "sports-day-results",
    excerpt: "",
    cover_image_file_id: null,
    status: "draft",
    published_at: null,
    locale: "",
    created_at: STAMP,
    updated_at: STAMP,
    body: { blocks: [] },
    ...overrides,
  };
}

export function buildSchoolEvent(overrides: Partial<SchoolEvent> = {}): SchoolEvent {
  return {
    id: uuid(),
    title: "Annual prize day",
    slug: "annual-prize-day",
    starts_at: "2026-12-10T05:00:00Z",
    ends_at: null,
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

export function buildGalleryAlbum(overrides: Partial<GalleryAlbum> = {}): GalleryAlbum {
  return {
    id: uuid(),
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

export function buildGalleryItem(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    id: uuid(),
    gallery_album_id: "",
    media_type: "image",
    file_id: uuid(),
    embed_url: "",
    caption: "",
    alt_text: "",
    position: 0,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** `content.py::validate_content_slug` and `slug_taken`, in the order the services check. */
function slugRefusal(slug: unknown, taken: boolean): MockResponse | undefined {
  if (typeof slug !== "string" || slug.length > 120 || !SLUG.test(slug)) {
    return refuse("slug", "invalid_slug", "use lowercase letters, digits and hyphens.");
  }
  return taken
    ? refuse("slug", "slug_taken", "another item already uses this address.")
    : undefined;
}

/** `item_services.py::_validate_item` for a video. */
function embedRefusal(url: string): MockResponse | undefined {
  if (!url) return refuse("embed_url", "embed_required", "a video item needs an embed URL.");
  if (url.length > EMBED_URL_MAX) {
    return refuse("embed_url", "invalid_url", "the embed URL is too long.");
  }
  if (!url.startsWith("https://")) {
    return refuse("embed_url", "invalid_url", "the embed URL must be an https URL.");
  }
  if (!EMBED_HOSTS.includes(new URL(url).hostname.toLowerCase())) {
    return refuse("embed_url", "embed_host_not_allowed", "this video host is not supported.");
  }
  return undefined;
}

interface Lifecycle {
  status: GalleryAlbum["status"];
  updated_at: string;
}

/** `:publish` / `:unpublish` / `:archive`, as `services.py` moves the status (idempotent). */
function transition(record: Lifecycle & { published_at?: string | null }, action: string) {
  record.updated_at = ACTED_AT;
  if (action === "publish") {
    record.status = "published";
    if ("published_at" in record) record.published_at = ACTED_AT;
  } else if (action === "unpublish" && record.status === "published") {
    record.status = "draft";
    if ("published_at" in record) record.published_at = null;
  } else if (action === "archive") {
    record.status = "archived";
    if ("published_at" in record) record.published_at = null;
  }
}

/** A list read: `status` and a title/slug `search`, in the stub's order, one page. */
function listOf(
  rows: readonly (Lifecycle & { title: string; slug: string })[],
  request: MockRequest,
): MockResponse {
  const params = request.searchParams;
  const search = params.get("search")?.toLowerCase();
  const matching = rows.filter(
    (row) =>
      (!params.get("status") || row.status === params.get("status")) &&
      (!search || `${row.title} ${row.slug}`.toLowerCase().includes(search)),
  );
  return pageOf(matching, params);
}

export interface WebsiteContentOptions {
  /** Held by reference, so a spec can read what a write left behind. */
  newsPosts?: NewsPost[];
  events?: SchoolEvent[];
  albums?: GalleryAlbum[];
  items?: GalleryItem[];
}

/**
 * `/news-posts`, `/school-events`, `/gallery-albums` and an album's `/gallery-items`, with
 * their colon actions, in the shapes the server sends. Mirrors the rules the screens surface
 * (L5), in the server's words: slug format and uniqueness, `end_before_start`, a video's link
 * rules, `empty_album` on publishing an album with no items, `unpublish_first` on deleting a
 * published post or album, events with no DELETE, and a reorder that must list every item of
 * the album exactly once (`invalid_item_ids`). Whether the server enforces them is the backend
 * suite's (the `apps/api/apps/website_cms` tests).
 */
export function websiteContentModule(options: WebsiteContentOptions = {}): MockModule {
  return (api) => {
    const posts = options.newsPosts ?? [];
    const events = options.events ?? [];
    const albums = options.albums ?? [];
    const items = options.items ?? [];
    const notFound = () => fail(404, "Not found.");
    const body = (request: MockRequest) => (request.json() as Record<string, unknown> | null) ?? {};
    const itemsOf = (albumId: string) =>
      items
        .filter((item) => item.gallery_album_id === albumId)
        .sort((a, b) => a.position - b.position);

    api.get("/news-posts", (request) => listOf(posts, request));
    api.get("/news-posts/:postId", (request) => {
      const post = posts.find((row) => row.id === request.params["postId"]);
      return post ? ok(post) : notFound();
    });
    api.post("/news-posts", (request) => {
      const input = body(request);
      const refusal = slugRefusal(
        input.slug,
        posts.some((row) => row.slug === input.slug),
      );
      if (refusal) return refusal;
      const post = buildNewsPost({ ...(input as Partial<NewsPost>), id: uuid(), status: "draft" });
      posts.unshift(post);
      return ok(post, { status: 201 });
    });
    api.patch("/news-posts/:postId", (request) => {
      const post = posts.find((row) => row.id === request.params["postId"]);
      if (!post) return notFound();
      Object.assign(post, body(request), { updated_at: ACTED_AT });
      return ok(post);
    });
    api.delete("/news-posts/:postId", (request) => {
      const post = posts.find((row) => row.id === request.params["postId"]);
      if (!post) return notFound();
      if (post.status === "published") {
        return refuse("status", "unpublish_first", "unpublish this post before deleting it.");
      }
      posts.splice(posts.indexOf(post), 1);
      return noContent();
    });
    // `router.ts` reads `:name` as a param, so `/news-posts/{id}:publish` lands here whole.
    api.post("/news-posts/:postAction", (request) => {
      const [postId, action = ""] = (request.params["postAction"] ?? "").split(":");
      const post = posts.find((row) => row.id === postId);
      if (!post) return notFound();
      transition(post, action);
      return ok(post);
    });

    api.get("/school-events", (request) => listOf(events, request));
    api.get("/school-events/:eventId", (request) => {
      const event = events.find((row) => row.id === request.params["eventId"]);
      return event ? ok(event) : notFound();
    });
    api.post("/school-events", (request) => {
      const input = body(request) as Partial<SchoolEvent>;
      const refusal = slugRefusal(
        input.slug,
        events.some((row) => row.slug === input.slug),
      );
      if (refusal) return refusal;
      if (input.ends_at && input.starts_at && input.ends_at < input.starts_at) {
        return refuse("ends_at", "end_before_start", "the event cannot end before it starts.");
      }
      const event = buildSchoolEvent({ ...input, id: uuid(), status: "draft" });
      events.unshift(event);
      return ok(event, { status: 201 });
    });
    api.post("/school-events/:eventAction", (request) => {
      const [eventId, action = ""] = (request.params["eventAction"] ?? "").split(":");
      const event = events.find((row) => row.id === eventId);
      if (!event) return notFound();
      transition(event, action);
      return ok(event);
    });

    api.get("/gallery-albums", (request) => listOf(albums, request));
    api.get("/gallery-albums/:albumId", (request) => {
      const album = albums.find((row) => row.id === request.params["albumId"]);
      return album ? ok(album) : notFound();
    });
    api.post("/gallery-albums/:albumAction", (request) => {
      const [albumId, action = ""] = (request.params["albumAction"] ?? "").split(":");
      const album = albums.find((row) => row.id === albumId);
      if (!album || action === "archive") return notFound();
      if (action === "publish" && itemsOf(album.id).length === 0) {
        return refuse("items", "empty_album", "add at least one item before publishing.");
      }
      transition(album, action);
      return ok(album);
    });

    api.get("/gallery-albums/:albumId/gallery-items", (request) => {
      const albumId = request.params["albumId"] ?? "";
      return albums.some((row) => row.id === albumId)
        ? pageOf(itemsOf(albumId), request.searchParams)
        : notFound();
    });
    api.post("/gallery-albums/:albumId/gallery-items", (request) => {
      const albumId = request.params["albumId"] ?? "";
      if (!albums.some((row) => row.id === albumId)) return notFound();
      const input = body(request) as Partial<GalleryItem>;
      const isVideo = input.media_type === "video_embed";
      const refusal = isVideo
        ? embedRefusal(input.embed_url ?? "")
        : input.file_id
          ? undefined
          : refuse("file_id", "file_required", "an image item needs a file.");
      if (refusal) return refusal;
      const existing = itemsOf(albumId);
      const item = buildGalleryItem({
        ...input,
        id: uuid(),
        gallery_album_id: albumId,
        file_id: isVideo ? null : (input.file_id ?? null),
        position: existing.length === 0 ? 0 : Math.max(...existing.map((row) => row.position)) + 1,
      });
      items.push(item);
      return ok(item, { status: 201 });
    });
    // `/gallery-albums/{id}/gallery-items:reorder`: the colon action is one path segment here.
    api.patch("/gallery-albums/:albumId/:itemsAction", (request) => {
      const albumId = request.params["albumId"] ?? "";
      if (request.params["itemsAction"] !== "gallery-items:reorder") return notFound();
      const live = itemsOf(albumId);
      const ids = (body(request).ids as string[] | undefined) ?? [];
      const same =
        new Set(ids).size === ids.length &&
        ids.length === live.length &&
        live.every((item) => ids.includes(item.id));
      if (!same) {
        return refuse("ids", "invalid_item_ids", "list every item of this album exactly once.");
      }
      for (const item of live) item.position = ids.indexOf(item.id);
      return ok(itemsOf(albumId));
    });
  };
}
