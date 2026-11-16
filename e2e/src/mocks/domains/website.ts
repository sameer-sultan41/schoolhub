import type { ApiSchemas } from "@schoolhub/api-client";
import { uuid } from "@/data/factories";
import { fail, noContent, ok, type MockResponse } from "../envelope";
import { compareValues, pageOf } from "../list";
import type { MockModule } from "../router";

/** The generated schema marks server-set fields `readonly`; a stub is the server, so it writes
 * them (a status, a position). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** The generated wire shapes: a contract change breaks these stubs at compile time (L41). */
export type WebsitePage = Writable<ApiSchemas["WebsitePageDetail"]>;
export type WebsitePageSection = Writable<ApiSchemas["PageSection"]>;
export type WebsiteTheme = ApiSchemas["Theme"];
export type WebsiteSettings = ApiSchemas["WebsiteSettings"];
type SectionInput = ApiSchemas["SectionInput"];
type PageWrite = ApiSchemas["WebsitePageWrite"];
type PagePreview = ApiSchemas["PagePreview"];

const STAMP = "2026-11-01T00:00:00Z";
const ACTED_AT = "2026-11-16T00:00:00Z";

/** `RESERVED_PAGE_SLUGS` (`apps/api/apps/website_cms/constants.py`). */
const RESERVED_SLUGS = [
  "admin",
  "api",
  "verify",
  "news",
  "events",
  "gallery",
  "notices",
  "preview",
  "sitemap.xml",
  "robots.txt",
];
/** `PAGE_SLUG_PATTERN`. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
/** `WebsitePageViewSet.ordering_fields`. */
const ORDERING_FIELDS = [
  "slug",
  "title",
  "status",
  "page_type",
  "published_at",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof WebsitePage)[];
/** `PREVIEW_TOKEN_MAX_AGE`. */
const PREVIEW_MAX_AGE = 600;

export function buildPageSection(overrides: Partial<WebsitePageSection> = {}): WebsitePageSection {
  return {
    id: uuid(),
    section_type: "hero",
    position: 0,
    content: { heading: "Welcome to our school" },
    is_visible: true,
    ...overrides,
  };
}

export function buildWebsitePage(overrides: Partial<WebsitePage> = {}): WebsitePage {
  return {
    id: uuid(),
    title: "About us",
    slug: "about",
    page_type: "about",
    status: "draft",
    published_at: null,
    locale: "",
    show_in_search: true,
    created_at: STAMP,
    updated_at: STAMP,
    sections: [],
    ...overrides,
  };
}

/** The default theme's catalogue, trimmed to the types and properties the specs use; every
 * keyword kept is `themes/default.json`'s own. */
export function buildWebsiteTheme(overrides: Partial<WebsiteTheme> = {}): WebsiteTheme {
  return {
    id: uuid(),
    code: "default",
    name: "Default",
    version: "1.0.0",
    description: "",
    config_schema: {},
    section_types: {
      hero: {
        label: "Hero",
        schema: {
          type: "object",
          properties: {
            heading: { type: "string", maxLength: 200, "x-widget": "text", minLength: 1 },
            subheading: { type: "string", maxLength: 300, "x-widget": "text" },
            image_file_id: { type: "string", minLength: 36, maxLength: 36, "x-widget": "image" },
          },
          required: ["heading"],
        },
      },
      news_list: {
        label: "News",
        schema: {
          type: "object",
          properties: {
            heading: { type: "string", maxLength: 200, "x-widget": "text" },
            limit: { type: "integer", minimum: 1, maximum: 24 },
          },
        },
      },
      faq: {
        label: "FAQ",
        schema: {
          type: "object",
          properties: {
            heading: { type: "string", maxLength: 200, "x-widget": "text" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string", maxLength: 300, "x-widget": "text", minLength: 1 },
                  answer: { type: "string", maxLength: 2000, "x-widget": "textarea", minLength: 1 },
                },
                required: ["question", "answer"],
              },
            },
          },
          required: ["items"],
        },
      },
    },
    ...overrides,
  };
}

export function buildWebsiteSettings(overrides: Partial<WebsiteSettings> = {}): WebsiteSettings {
  return {
    exists: true,
    theme_code: "default",
    theme_version: "1.0.0",
    is_published: true,
    maintenance_mode: false,
    updated_at: STAMP,
    ...overrides,
  };
}

/** The preview URL `:preview` answers with, on the school's own host. */
export function pagePreviewUrl(pageId: string): string {
  return `https://greenfield.e2e.test/api/preview?token=e2e-${pageId}`;
}

/** A 422 as `website_cms.errors.violation` raises it: `<reason>: <sentence>` under `field`.
 * Shared with `website-content.ts`, the news, events and gallery stub. */
export function refuse(
  field: string,
  reason: string,
  sentence: string,
  withMeta = true,
): MockResponse {
  const issue = `${reason}: ${sentence}`;
  return fail(422, issue, {
    code: "domain_rule_violation",
    details: [{ field, issue }],
    ...(withMeta ? { meta: { reason } } : {}),
  });
}

export interface WebsitePagesOptions {
  /** Held by reference, so a spec can read what a write left behind. */
  pages?: WebsitePage[];
  theme?: WebsiteTheme;
  settings?: WebsiteSettings;
  /** Page ids a navigation menu links to (`page_in_use` on delete or archive). */
  menuTargets?: string[];
}

/**
 * `/website-settings`, `/themes` and `/website-pages` with its sections, lifecycle actions and
 * preview, in the shapes the server sends. Mirrors the server's rules the screens surface
 * (lesson L5), in its words (`pages/services.py`):
 * - a slug must match `PAGE_SLUG_PATTERN`, not start with a reserved segment
 *   (`reserved_slug`) and not be taken (`slug_taken`); a second home page is `home_exists`;
 * - publishing needs a visible section (`no_visible_sections`);
 * - deleting a published page is `unpublish_first`; deleting or archiving the home page or a
 *   menu's target is `page_in_use`;
 * - `PATCH …/page-sections` replaces the list, keeping given ids and positions in order, and
 *   refuses a type the theme lacks under `sections.<i>.section_type`.
 *
 * Whether the server enforces any of this is the live lane's.
 */
export function websitePagesModule(options: WebsitePagesOptions = {}): MockModule {
  return (api) => {
    const pages = options.pages ?? [];
    const theme = options.theme ?? buildWebsiteTheme();
    const settings = options.settings ?? buildWebsiteSettings();
    const menuTargets = options.menuTargets ?? [];
    const sectionTypes = (theme.section_types ?? {}) as Record<string, unknown>;

    const find = (pageId: string | undefined) => pages.find((page) => page.id === pageId);
    const listShape = ({ sections: _sections, ...page }: WebsitePage) => page;
    const inUse = (page: WebsitePage) =>
      page.page_type === "home"
        ? "it is the homepage"
        : menuTargets.includes(page.id)
          ? "it is linked from the header menu"
          : null;

    api.get("/website-settings", () => ok(settings));
    api.get("/themes", () => pageOf([theme], new URLSearchParams()));

    api.get("/website-pages", (request) => {
      const params = request.searchParams;
      const search = params.get("search")?.toLowerCase();
      const matching = pages.filter(
        (page) =>
          (!params.get("status") || page.status === params.get("status")) &&
          (!params.get("page_type") || page.page_type === params.get("page_type")) &&
          (!search || `${page.title} ${page.slug}`.toLowerCase().includes(search)),
      );
      const ordering = params.get("ordering") ?? "slug";
      const field = ordering.replace(/^-/, "");
      const key = ORDERING_FIELDS.find((candidate) => candidate === field) ?? "slug";
      const direction = ordering.startsWith("-") ? -1 : 1;
      const ordered = [...matching].sort(
        (a, b) => direction * compareValues(a[key], b[key]) || compareValues(a.id, b.id),
      );
      return pageOf(ordered.map(listShape), params);
    });

    api.post("/website-pages", (request) => {
      const body = (request.json() as Partial<PageWrite> | null) ?? {};
      const slug = body.slug ?? "";
      if (!SLUG_PATTERN.test(slug)) {
        return refuse(
          "slug",
          "invalid_slug",
          "use lowercase letters, digits and hyphens, joined by '/'.",
          false,
        );
      }
      if (RESERVED_SLUGS.includes(slug.split("/")[0] ?? "")) {
        return refuse("slug", "reserved_slug", "this address is reserved.", false);
      }
      if (body.page_type === "home") {
        return refuse("page_type", "home_exists", "the site has one home page.", false);
      }
      if (pages.some((page) => page.slug === slug)) {
        return refuse("slug", "slug_taken", "another page already uses this address.", false);
      }
      const created = buildWebsitePage({
        title: body.title ?? "",
        slug,
        page_type: body.page_type ?? "standard",
        show_in_search: body.show_in_search ?? true,
        sections: [],
      });
      pages.push(created);
      return ok(created, { status: 201, meta: { message: "Page created." } });
    });

    api.get("/website-pages/:pageId", (request) => {
      const page = find(request.params["pageId"]);
      return page ? ok(page) : fail(404, "Not found.");
    });

    api.patch("/website-pages/:pageId", (request) => {
      const page = find(request.params["pageId"]);
      if (!page) return fail(404, "Not found.");
      Object.assign(page, (request.json() as Partial<PageWrite> | null) ?? {}, {
        updated_at: ACTED_AT,
      });
      return ok(page);
    });

    api.delete("/website-pages/:pageId", (request) => {
      const page = find(request.params["pageId"]);
      if (!page) return fail(404, "Not found.");
      if (page.status === "published") {
        return refuse("status", "unpublish_first", "unpublish this page before deleting it.");
      }
      const reason = inUse(page);
      if (reason) {
        return refuse("page", "page_in_use", `this page cannot be removed because ${reason}.`);
      }
      pages.splice(pages.indexOf(page), 1);
      return noContent();
    });

    api.patch("/website-pages/:pageId/page-sections", (request) => {
      const page = find(request.params["pageId"]);
      if (!page) return fail(404, "Not found.");
      const body = request.json() as { sections?: SectionInput[] } | null;
      const sections = body?.sections ?? [];
      const unknown = sections.findIndex((section) => !(section.section_type in sectionTypes));
      if (unknown >= 0) {
        const type = sections[unknown]?.section_type ?? "";
        const issue = `Unknown section type '${type}'.`;
        return fail(422, issue, {
          code: "domain_rule_violation",
          details: [{ field: `sections.${unknown}.section_type`, issue }],
        });
      }
      page.sections = sections.map((section, position) => ({
        id: section.id ?? uuid(),
        section_type: section.section_type,
        position,
        content: section.content,
        is_visible: section.is_visible,
      }));
      page.updated_at = ACTED_AT;
      return ok(page.sections, { meta: { message: "Sections updated." } });
    });

    // `router.ts` reads `:name` as a param, so `/website-pages/{id}:publish` lands here whole.
    api.post("/website-pages/:pageAction", (request) => {
      const [pageId, action] = (request.params["pageAction"] ?? "").split(":");
      const page = find(pageId);
      if (!page) return fail(404, "Not found.");
      switch (action) {
        case "publish":
          if (!page.sections.some((section) => section.is_visible)) {
            return refuse(
              "sections",
              "no_visible_sections",
              "add at least one visible section before publishing.",
            );
          }
          Object.assign(page, { status: "published", published_at: ACTED_AT });
          return ok(page, { meta: { message: "Page published." } });
        case "unpublish":
          Object.assign(page, { status: "draft", published_at: null });
          return ok(page, { meta: { message: "Page unpublished." } });
        case "archive": {
          const reason = inUse(page);
          if (reason) {
            return refuse("page", "page_in_use", `this page cannot be removed because ${reason}.`);
          }
          Object.assign(page, { status: "archived", published_at: null });
          return ok(page, { meta: { message: "Page archived." } });
        }
        case "preview": {
          const preview: PagePreview = {
            url: pagePreviewUrl(page.id),
            expires_in: PREVIEW_MAX_AGE,
          };
          return ok(preview);
        }
        default:
          return fail(404, "Not found.");
      }
    });
  };
}
