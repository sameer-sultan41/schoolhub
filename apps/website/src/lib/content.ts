import type { ApiSchemas } from "@schoolhub/api-client";
import { cache } from "react";
import { hostTag, pageTag, readJson, tenantTag } from "./api";

/**
 * Public content reads. **Every export in this file is a read.**
 *
 * This module is the enforcement point for the renderer's zero-write rule
 * (website-builder.md §6): it exposes no create/update/delete function, and the transport it
 * uses (`lib/api.ts`) has no write method to call. If a feature seems to need a write here,
 * it belongs in a browser → `/api/v1/public/...` submission instead.
 *
 * Every read sends the request's host (website-cms §16); the API resolves the school from it
 * and answers only published, opted-in content. `tenantId` is used for cache tags only; every
 * read is also tagged with its host, so a host that moves to another school is evicted too.
 * Arguments stay primitive so React's `cache()` dedupes repeat calls within a render.
 */

type PublicPage = ApiSchemas["PublicPage"];
type PublicSite = ApiSchemas["PublicSite"];
type PublicSitemapEntry = ApiSchemas["PublicSitemapEntry"];
type PublicTeacher = ApiSchemas["PublicTeacher"];
type PublicDepartment = ApiSchemas["PublicDepartment"];
type PublicClass = ApiSchemas["PublicClass"];
type PublicSchoolEvent = ApiSchemas["PublicSchoolEvent"];
type PublicNewsPost = ApiSchemas["PublicNewsPost"];
type PublicNotice = ApiSchemas["PublicNotice"];
type PublicGalleryImage = ApiSchemas["PublicGalleryImage"];

/** The API's `page_size` ceiling for every public list (`PUBLIC_LIST_MAX`). */
export const PUBLIC_LIST_MAX = 50;

export type EventScope = "upcoming" | "past";

function pageSize(limit: number): number {
  return Math.min(Math.max(1, limit), PUBLIC_LIST_MAX);
}

/** Normalise a catch-all route's segments into the CMS page slug (`""` = homepage). */
export function toPageSlug(segments: string[] | undefined): string {
  return (segments ?? []).filter(Boolean).join("/");
}

/** The homepage is asked for with no slug: `slug=home` is a 404 by contract. */
export const getPage = cache(
  async (tenantId: string, host: string, slug: string): Promise<PublicPage | null> =>
    readJson<PublicPage>("/public/pages", {
      host,
      query: { slug: slug || undefined },
      tags: [tenantTag(tenantId), hostTag(host), pageTag(tenantId, slug)],
    }),
);

export const getSite = cache(async (tenantId: string, host: string): Promise<PublicSite | null> =>
  readJson<PublicSite>("/public/site", {
    host,
    tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:site`],
  }),
);

export const getPublishedPaths = cache(
  async (tenantId: string, host: string): Promise<PublicSitemapEntry[]> =>
    (await readJson<PublicSitemapEntry[]>("/public/sitemap", {
      host,
      tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:sitemap`],
    })) ?? [],
);

/**
 * Dynamic sections read live module data through dedicated public endpoints rather than
 * duplicating it into the CMS (website-builder.md §2). Staff and class data appear only
 * when the school has explicitly opted the record in (`show_on_website`).
 */

export const getTeachers = cache(
  async (tenantId: string, host: string, limit = 12): Promise<PublicTeacher[]> =>
    (await readJson<PublicTeacher[]>("/public/teachers", {
      host,
      query: { page_size: pageSize(limit) },
      tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:teachers`],
    })) ?? [],
);

export const getDepartments = cache(
  async (tenantId: string, host: string): Promise<PublicDepartment[]> =>
    (await readJson<PublicDepartment[]>("/public/departments", {
      host,
      tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:departments`],
    })) ?? [],
);

export const getClasses = cache(
  async (tenantId: string, host: string): Promise<PublicClass[]> =>
    (await readJson<PublicClass[]>("/public/classes", {
      host,
      tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:classes`],
    })) ?? [],
);

export const getEvents = cache(
  async (
    tenantId: string,
    host: string,
    limit = 6,
    scope: EventScope = "upcoming",
  ): Promise<PublicSchoolEvent[]> =>
    (await readJson<PublicSchoolEvent[]>("/public/school-events", {
      host,
      query: { scope, page_size: pageSize(limit) },
      tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:events`],
    })) ?? [],
);

export const getNews = cache(
  async (tenantId: string, host: string, limit = 6): Promise<PublicNewsPost[]> =>
    (await readJson<PublicNewsPost[]>("/public/news-posts", {
      host,
      query: { page_size: pageSize(limit) },
      tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:news`],
    })) ?? [],
);

export const getNotices = cache(
  async (tenantId: string, host: string, limit = 8): Promise<PublicNotice[]> =>
    (await readJson<PublicNotice[]>("/public/notices", {
      host,
      query: { page_size: pageSize(limit) },
      tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:notices`],
    })) ?? [],
);

/** The latest images across published albums, for the `gallery` section. */
export const getGallery = cache(
  async (tenantId: string, host: string, limit = 24): Promise<PublicGalleryImage[]> =>
    (await readJson<PublicGalleryImage[]>("/public/gallery-items", {
      host,
      query: { page_size: pageSize(limit) },
      tags: [tenantTag(tenantId), hostTag(host), `tenant:${tenantId}:gallery`],
    })) ?? [],
);
