import type {
  GalleryImage,
  PublicClass,
  PublicDepartment,
  PublicEvent,
  PublicNewsPost,
  PublicNotice,
  PublicTeacher,
  SiteSettings,
  SitemapEntry,
  WebsitePage,
} from "@schoolhub/types";
import { cache } from "react";
import { pageTag, readJson, tenantTag } from "./api";

/**
 * Public content reads. **Every export in this file is a read.**
 *
 * This module is the enforcement point for the renderer's zero-write rule
 * (website-builder.md §6): it exposes no create/update/delete function, and the transport it
 * uses (`lib/api.ts`) has no write method to call. If a feature seems to need a write here,
 * it belongs in a browser → `/api/v1/public/...` submission instead.
 *
 * Only published, explicitly-publishable content is returned — the API filters on the
 * machine token's `website.public-content.view` scope; we never ask for drafts.
 */

/** Normalise a catch-all route's segments into the CMS page slug (`""` = homepage). */
export function toPageSlug(segments: string[] | undefined): string {
  return (segments ?? []).filter(Boolean).join("/");
}

export const getPage = cache(async (tenantId: string, slug: string): Promise<WebsitePage | null> =>
  readJson<WebsitePage>("/public/pages", {
    query: { slug: slug || "home" },
    tags: [tenantTag(tenantId), pageTag(tenantId, slug)],
  }),
);

export const getSiteSettings = cache(async (tenantId: string): Promise<SiteSettings | null> =>
  readJson<SiteSettings>("/public/site-settings", {
    tags: [tenantTag(tenantId), `tenant:${tenantId}:settings`],
  }),
);

export const getPublishedPaths = cache(
  async (tenantId: string): Promise<SitemapEntry[]> =>
    (await readJson<SitemapEntry[]>("/public/pages/sitemap", {
      tags: [tenantTag(tenantId), `tenant:${tenantId}:sitemap`],
    })) ?? [],
);

/**
 * Dynamic sections read live module data through dedicated public endpoints rather than
 * duplicating it into the CMS (website-builder.md §2). Staff and student data appear only
 * when the tenant has explicitly marked them public.
 */

export const getTeachers = cache(
  async (tenantId: string, limit = 12): Promise<PublicTeacher[]> =>
    (await readJson<PublicTeacher[]>("/public/teachers", {
      query: { page_size: limit },
      tags: [tenantTag(tenantId), `tenant:${tenantId}:teachers`],
    })) ?? [],
);

export const getDepartments = cache(
  async (tenantId: string): Promise<PublicDepartment[]> =>
    (await readJson<PublicDepartment[]>("/public/departments", {
      tags: [tenantTag(tenantId), `tenant:${tenantId}:departments`],
    })) ?? [],
);

export const getClasses = cache(
  async (tenantId: string): Promise<PublicClass[]> =>
    (await readJson<PublicClass[]>("/public/classes", {
      tags: [tenantTag(tenantId), `tenant:${tenantId}:classes`],
    })) ?? [],
);

export const getEvents = cache(
  async (tenantId: string, limit = 6): Promise<PublicEvent[]> =>
    (await readJson<PublicEvent[]>("/public/events", {
      query: { page_size: limit },
      tags: [tenantTag(tenantId), `tenant:${tenantId}:events`],
    })) ?? [],
);

export const getNews = cache(
  async (tenantId: string, limit = 6): Promise<PublicNewsPost[]> =>
    (await readJson<PublicNewsPost[]>("/public/news", {
      query: { page_size: limit },
      tags: [tenantTag(tenantId), `tenant:${tenantId}:news`],
    })) ?? [],
);

export const getNotices = cache(
  async (tenantId: string, limit = 8): Promise<PublicNotice[]> =>
    (await readJson<PublicNotice[]>("/public/notices", {
      query: { page_size: limit },
      tags: [tenantTag(tenantId), `tenant:${tenantId}:notices`],
    })) ?? [],
);

export const getGallery = cache(
  async (tenantId: string, limit = 24): Promise<GalleryImage[]> =>
    (await readJson<GalleryImage[]>("/public/gallery", {
      query: { page_size: limit },
      tags: [tenantTag(tenantId), `tenant:${tenantId}:gallery`],
    })) ?? [],
);
