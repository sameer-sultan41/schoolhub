# Public School Website Architecture (Website Builder)

> **Agent Context**
> **Summary:** Technical architecture for the dynamic public school websites (scope §11): one Next.js multi-tenant renderer resolving the tenant from the Host header (wildcard subdomains + verified custom domains with automated TLS); theme system v1 = one theme built from section components + theme tokens driven by tenant branding; page content from `website_pages`/`page_sections` via a read-only machine-token API keyed by a `host` parameter; ISR with publish-time invalidation; SEO; the future multi-theme model; and the security boundary (renderer never writes — public forms POST to rate-limited API endpoints).
> **Co-load with:** [`multi-tenancy.md`](multi-tenancy.md) · [`api-architecture.md`](api-architecture.md) · [`../03-modules/website-cms.md`](../03-modules/website-cms.md)

## 1. One Renderer, Many Sites

A single Next.js 16 application (`apps/website` in the frontend monorepo, see [`repo-structure.md`](repo-structure.md)) serves **every** school's public website. There is no per-tenant deployment, build, or code.

**Tenant resolution by Host header**, evaluated in middleware on every request:

1. `<slug>.<platform-domain>` — wildcard subdomain; slug → tenant lookup (cached).
2. A **verified custom domain** (e.g. `www.cityschool.edu.pk`) — matched against the tenant custom-domain table.
3. Unknown host → platform landing page or 404; suspended tenant → neutral notice page ([`multi-tenancy.md`](multi-tenancy.md) §7).

**Custom domain lifecycle:** tenant admin adds the domain in the dashboard → platform issues a verification token (DNS TXT) and the CNAME target → automated verification job confirms DNS → TLS certificate is issued automatically at the hosting edge (ACME/managed certificates, wildcard cert covers all subdomains) → domain flips to `active`. Failed or lapsed verification falls back to the subdomain, never to another tenant's content.

## 2. Theme System v1

Version 1 ships **one theme**; the architecture treats it as the first entry in a theme registry, not a special case.

- A **theme** = a set of **section components** (Hero, AboutSchool, PrincipalMessage, DepartmentsGrid, TeachersGrid, ClassesList, AdmissionsCTA, EventsList, NewsList, NoticeBoard, Gallery, ContactForm, RichText, Faq, Navigation, Footer) + a **theme token contract**.
- **Theme tokens** (colors, fonts, logo, favicon) are generated from the tenant's branding configuration ([`multi-tenancy.md`](multi-tenancy.md) §5) and injected as CSS custom properties — so one theme renders visually distinct per school with zero code differences.
- **Content** comes from the CMS tables `website_pages` (page slug, title, SEO fields, published state, nav placement) and `page_sections` (ordered rows: section type + JSONB props conforming to that section's schema). Entity detail: [`../05-database/entities/website-cms.md`](../05-database/entities/website-cms.md). Dynamic data sections (teachers, events, news, notices) reference live module data through dedicated public read endpoints rather than duplicating it into the CMS.
- The renderer maps `section.type → React component` from the active theme's registry; unknown section types render nothing (forward compatibility when themes evolve).

### 2.1 Standard Page Catalog (v1)

A school's site is created on its first CMS write (`ensure_default_site`, from `apps/api/apps/website_cms/defaults.py`; [`multi-tenancy.md`](multi-tenancy.md) §7 may call it at provisioning later). Every standard page starts as a **draft** with valid placeholder sections, so the school edits real text instead of facing an empty site. Tenants can add pages and reorder, hide, edit or replace any section:

| Page (path) | Seeded sections | Data source |
| ----------- | --------------- | ----------- |
| Home (`/`) | Hero, NewsList, EventsList | CMS + news posts and school events |
| About us (`/about`) | AboutSchool | CMS content |
| Principal's message (`/principal-message`) | PrincipalMessage | CMS content |
| Departments (`/departments`) | DepartmentsGrid | School organisation (`show_on_website` departments) |
| Teachers (`/teachers`) | TeachersGrid | Staff module (opt-in published profiles only) |
| Classes (`/classes`) | ClassesList | School organisation (`show_on_website` classes) |
| Admissions (`/admissions`) | AdmissionsCTA | CMS; a ContactForm set to `admission_enquiry` posts an enquiry |
| Contact (`/contact`) | ContactForm | CMS + the public contact endpoint |

**Section types** (theme `default` v1.0.0, declared in `apps/api/apps/website_cms/themes/default.json`; any page may use any of them): `hero`, `about_school`, `principal_message`, `departments_grid`, `teachers_grid`, `classes_list`, `admissions_cta`, `events_list`, `news_list`, `notice_board` (communication notices flagged for the website), `gallery`, `contact_form`, `rich_text` (a block document: paragraphs, headings, lists, quotes and images, so no markup is ever stored) and `faq` (question and answer pairs, rendered as native `<details>` disclosures).

**Content routes** outside the page tree render one published item each: `/news/{slug}` (with `NewsArticle` JSON-LD), `/events/{slug}` (with `Event` JSON-LD) and `/gallery/{slug}` (an album's items in order; a video item links to its host rather than embedding it).

Staff and student data appear on the public site **only** when explicitly marked public by the tenant — the default for all personal data is private.

## 3. Data Access & Caching

- **Machine token.** The renderer calls the API with `Authorization: Bearer <token>`. The token belongs to the platform machine client `website-renderer` and holds one scope, `website.public-content.view`: read-only, public-published content only, per [`api-architecture.md`](api-architecture.md) §2.2 and [ADR-0039](../decisions/0039-public-content-api.md). `WEBSITE_MACHINE_TOKENS` is a comma-separated list, newest first, and every listed token is accepted, so a token rotates with overlap: add the new one first, deploy the renderer with it, then remove the old one. An empty list rejects every token. The token opens nothing under the CMS routes, and a staff JWT opens nothing under `/api/v1/public/`.
- **Host parameter.** Every read passes `?host=<the request's host>`. The API is the single tenancy resolver: it matches one label under the platform domain, or an active custom domain, and answers 404 for anything else, so the renderer never asserts a tenant id. `GET /api/v1/public/tenants/by-host` is the one read that reports a school that is suspended or whose site is unpublished or in maintenance, so the renderer can show the right notice.
- **Contract.** The routes, shapes and status codes are in [`../03-modules/website-cms.md`](../03-modules/website-cms.md) §16; the renderer uses the generated types, not hand-written ones. The homepage is read with an empty `slug`, never `slug=home`.
- **Media.** Content carries `<name>_url` links to `GET /api/v1/public/files/{tenant_id}/{file_id}`, which answers 302 to a presigned link and `Cache-Control: public, max-age=300`. Only a `ready` file marked `public` (referenced by published content) is served; every other case is the same 404. The link is stable, so an optimiser or CDN can cache it.
- **Preview.** Drafts are visible only through a short-lived signed token issued by the dashboard (`POST …:preview`, 600 s). The editor's link carries it in the query string to the renderer's `/api/preview?token=…` (the one place it is in a URL, so it can appear in that access log and the browser's history for its 600 s life). The renderer then calls `GET /public/pages?host=` with the token in the `X-Preview-Token` header only, never in a query string; only on a 200 does it store the token in an httpOnly, Secure, `SameSite=Lax` cookie with a 600 s lifetime and redirect to the path the API returned. That cookie is the only switch: Next.js draft mode is not used, because its `__prerender_bypass` cookie is one value for the whole build and would work on every school's host. Under the cookie only the `pages` and `site` reads send the token, with `cache: "no-store"`; a refused (404) or throttled (429) preview read falls back to the cached published read, and every other read stays cached. The API counts reads carrying the header per (machine client, host) in their own bucket (`public_preview`, 60/min), instead of the per-host machine quota, and sends `Vary: X-Preview-Token` and `Cache-Control: no-store` on a preview read.
- **Rendering strategy: ISR (Incremental Static Regeneration)** per tenant + path (recommendation). Pages render on first request, are cached at the edge, and revalidate on a modest TTL (e.g. 5 minutes) as a safety net.
- **Publish-time invalidation.** After a publish, unpublish or settings change commits, the API's Celery task POSTs `{tenant_id, tags}` to the renderer's `/api/revalidate`, signed with HMAC-SHA256 over the raw body (`x-schoolhub-signature`, secret shared through `REVALIDATE_SECRET`). The renderer always drops the tenant-wide `tenant:<id>` tag, which every read carries. Changes to what `by-host` reports (site settings, the module flag, a custom domain) also send `tenant-host:<host>` for every host of the school (its subdomain and active custom domains), so a cached `website_status` never goes stale; the renderer's route accepts those `tenant-host:<host>` tags. A failure retries with backoff (5 times), and an unset URL is a no-op.
- Per-tenant cache keys always include the resolved tenant ID — a cache entry can never be served across hosts.

## 4. SEO

- **Per-page meta:** title, description, canonical URL, Open Graph/Twitter card image — editable per page in the CMS, with sensible defaults from school branding.
- **`sitemap.xml` and `robots.txt`** generated per tenant (per host) from published pages; unpublished/suspended sites emit `noindex`.
- **Structured data:** JSON-LD `School`/`EducationalOrganization` on the homepage, `Event` for events, `NewsArticle` for news posts (recommendation).
- Server-side rendering guarantees crawlable HTML; Core Web Vitals budgets and accessibility requirements are defined in [`../07-quality/non-functional.md`](../07-quality/non-functional.md).
- Custom domains are the canonical host when active (the subdomain permanently redirects to it, a 308) to avoid duplicate-content penalties.

## 5. Future Multi-Theme Model

Designed now, shipped later (scope §11 "WordPress-style" direction):

- A **theme registry** in code: each theme exports its section-component set, token contract, and a manifest (name, preview screenshots, supported section types). Themes are platform code — **no per-tenant custom code, ever** (isolation and supportability boundary).
- Tenants get a **theme selection** setting; switching themes re-renders the same `website_pages`/`page_sections` content through the new theme's components. Section-type schemas are theme-independent, so content survives theme switches; a theme lacking a section type simply skips it.
- New themes are added by shipping code + registry entry; no migration of tenant content is required. Per-theme token extensions must declare defaults so existing branding maps cleanly.

## 6. Security Boundary

The public renderer is treated as a **zero-write, minimum-privilege client**:

- Its machine token cannot write anything and cannot read non-public data; compromise of the renderer exposes only already-public content.
- **Public forms** (contact today; admission enquiry once admissions exists) POST from the browser **directly to public API endpoints** (`POST /api/v1/public/contact-submissions`) — not through the renderer's token. These endpoints are:
  - tenant-resolved server-side from the `X-Tenant-Slug` header and re-validated against the `Origin` header's host, which must resolve to the same school,
  - rate-limited per client IP and per school (CAPTCHA escalation on abuse is a recommendation),
  - strictly validated and size-limited (32 KB JSON body, 413 above, 415 for other content types), with a honeypot field, feeding the school's contact inbox,
  - idempotency-protected against duplicate submissions ([`api-architecture.md`](api-architecture.md) §2.5); the browser sends a random key per submission.
- **CORS for public forms.** The API allows a browser origin on `/api/v1/public/` only when its host is the subdomain or an active custom domain of an operational school (resolved from the database, cached 60 s, closed on error), https only outside local development. No other path gains a tenant origin.
- No authentication cookies exist on public sites; the renderer and dashboard run on separate origins so no session can bleed between them. The one cookie is the preview cookie above: httpOnly, Secure, `SameSite=Lax`, 600 s, carrying only a signed token for one page of one school. It is set only after the API accepted the token, and it is the only preview switch (no Next.js draft mode, whose cookie is build-wide); a replayed or forged one can at most exhaust that school's own preview bucket (`public_preview`, per machine client and host, used instead of the content quota), after which that school's previews show published content; its published site and every other school are unaffected.
- Uploaded media (gallery images, documents) stays in the private bucket. Only the redirect route serves a file, and only when published content references it ([ADR-0039](../decisions/0039-public-content-api.md)).
- Per-IP throttles and stored IPs depend on `NUM_PROXIES` matching the proxy chain in front of the API (production requires it).

## 7. Request Flow Summary

As built in `apps/website` (its `AGENTS.md` maps each step to its file):

1. **Host.** The browser requests `https://<host>/<path>`. The proxy (`src/proxy.ts`, no I/O) normalises the host, strips any inbound `x-schoolhub-*` header and classifies the host as a school subdomain or a custom domain; a host it cannot parse goes to the platform landing page. `/api/revalidate`, `/api/preview` and `/api/health` (the load balancer's liveness check, no I/O) pass through on any host.
2. **School.** The root layout asks `GET /api/v1/public/tenants/by-host?host=<host>` with `Authorization: Bearer <WEBSITE_MACHINE_TOKEN>`. An unknown host renders the 404 page; a suspended school, or a site unpublished or in maintenance, renders a neutral "This website is unavailable" notice; a live school's subdomain with an active custom domain answers a permanent redirect (308) to the same path on that domain.
3. **Content.** The route reads `site`, `pages` (an empty `slug` for `/`) and each section's data (`news-posts`, `school-events`, `gallery-items`, `teachers`, `departments`, `classes`, `notices`), every read with `?host=` and the token. The API resolves the school from the host and binds it for RLS, so the renderer never asserts a tenant. Each read is fetch-cached for `CONTENT_REVALIDATE_SECONDS` (300 s) and tagged `tenant:<id>` and `tenant-host:<host>`. The page renders with the school's theme tokens; a section type the theme lacks renders nothing.
4. **Preview.** The dashboard's preview link opens `/api/preview?token=…`. The renderer checks the token against `pages` (header `X-Preview-Token`), then sets the 600 s preview cookie and redirects to the page's path; Next.js draft mode is never enabled. Under the cookie, `pages` and `site` are read with the token and uncached; a page the token does not cover falls back to its published version. The exit is a `POST` form (links get prefetched) that clears the cookie.
5. **Publish.** A publish, unpublish or settings change queues `website_cms.revalidate_website` on commit. The worker POSTs the signed `{tenant_id, tags}` to `WEBSITE_REVALIDATE_URL` (deployed: `https://<platform-domain>/api/revalidate`, through CloudFront, with `User-Agent: schoolhub-api/website-revalidate` so the WAF's managed rules admit it), which expires the school's tags at once (`revalidateTag(tag, { expire: 0 })`), so the next request reads fresh content.
6. **Media.** An image URL is the API's public file route, `<API_PUBLIC_URL>/api/v1/public/files/{tenant_id}/{file_id}`, which answers 302 to a presigned storage link with `max-age=300`. `next/image` optimises only that route over https (`images.remotePatterns`, one entry per hostname in the build's `WEBSITE_IMAGE_HOSTNAME`, e.g. `**.<prod domain>`, which matches `api.<prod domain>` and `api.staging.<prod domain>`) and follows the one redirect. It keeps an optimised image for `minimumCacheTTL` = 300 s, the API's `PUBLIC_FILE_CACHE_SECONDS`, so an unpublished image stops being served as soon as the API stops serving it (Next's own default would keep it four hours). A school logo may be on any https host, so it loads unoptimised. Compose and the E2E lanes build with `WEBSITE_IMAGES_UNOPTIMIZED=true`: their API is on a local address the optimiser refuses, so the browser loads the image URL itself. The `images` config is fixed at `next build`, so `WEBSITE_IMAGE_HOSTNAME` is the same value for every environment and one image is promoted unchanged; every other renderer value is server-only and read at runtime.
7. **Forms.** A contact or admission-enquiry form posts from the browser to `${API_PUBLIC_ORIGIN}/api/v1/public/contact-submissions` (§6), never through the renderer. The server reads `API_PUBLIC_ORIGIN` at runtime and passes it to the form as a prop.

Performance targets (LCP, TTFB, availability) for public sites are defined in [`../07-quality/non-functional.md`](../07-quality/non-functional.md); because pages are static-served between publishes, public traffic places near-zero load on the API and database.

## 8. Component Summary

| Concern | Owner |
| ------- | ----- |
| Page/section content editing, publish workflow | Website CMS module (dashboard) — [`../03-modules/website-cms.md`](../03-modules/website-cms.md) |
| Rendering, theming, ISR, SEO output | `apps/website` renderer (this document) |
| Public content read API + public form endpoints | `schoolhub-api` ([`api-architecture.md`](api-architecture.md)) |
| Domain verification, TLS automation | Platform infrastructure ([`hosting-deployment.md`](hosting-deployment.md)) |
| Branding tokens | Tenant configuration ([`multi-tenancy.md`](multi-tenancy.md) §5) |
