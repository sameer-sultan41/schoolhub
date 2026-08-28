# Public School Website Architecture (Website Builder)

> **Agent Context**
> **Summary:** Technical architecture for the dynamic public school websites (scope §11): one Next.js multi-tenant renderer resolving the tenant from the Host header (wildcard subdomains + verified custom domains with automated TLS); theme system v1 = one theme built from section components + theme tokens driven by tenant branding; page content from `website_pages`/`page_sections` via a read-only machine-token API; ISR with publish-time invalidation; SEO; the future multi-theme model; and the security boundary (renderer never writes — public forms POST to rate-limited API endpoints).
> **Co-load with:** [`multi-tenancy.md`](multi-tenancy.md) · [`api-architecture.md`](api-architecture.md) · [`../03-modules/website-cms.md`](../03-modules/website-cms.md)

## 1. One Renderer, Many Sites

A single Next.js 15 application (`apps/website` in the frontend monorepo, see [`repo-structure.md`](repo-structure.md)) serves **every** school's public website. There is no per-tenant deployment, build, or code.

**Tenant resolution by Host header**, evaluated in middleware on every request:

1. `<slug>.<platform-domain>` — wildcard subdomain; slug → tenant lookup (cached).
2. A **verified custom domain** (e.g. `www.cityschool.edu.pk`) — matched against the tenant custom-domain table.
3. Unknown host → platform landing page or 404; suspended tenant → neutral notice page ([`multi-tenancy.md`](multi-tenancy.md) §7).

**Custom domain lifecycle:** tenant admin adds the domain in the dashboard → platform issues a verification token (DNS TXT) and the CNAME target → automated verification job confirms DNS → TLS certificate is issued automatically at the hosting edge (ACME/managed certificates, wildcard cert covers all subdomains) → domain flips to `active`. Failed or lapsed verification falls back to the subdomain, never to another tenant's content.

## 2. Theme System v1

Version 1 ships **one theme**; the architecture treats it as the first entry in a theme registry, not a special case.

- A **theme** = a set of **section components** (Hero, AboutSchool, PrincipalMessage, DepartmentsGrid, TeachersGrid, ClassesList, AdmissionsCTA, EventsList, NewsList, NoticeBoard, Gallery, ContactForm, Navigation, Footer) + a **theme token contract**.
- **Theme tokens** (colors, fonts, logo, favicon) are generated from the tenant's branding configuration ([`multi-tenancy.md`](multi-tenancy.md) §5) and injected as CSS custom properties — so one theme renders visually distinct per school with zero code differences.
- **Content** comes from the CMS tables `website_pages` (page slug, title, SEO fields, published state, nav placement) and `page_sections` (ordered rows: section type + JSONB props conforming to that section's schema). Entity detail: [`../05-database/entities/website-cms.md`](../05-database/entities/website-cms.md). Dynamic data sections (teachers, events, news, notices) reference live module data through dedicated public read endpoints rather than duplicating it into the CMS.
- The renderer maps `section.type → React component` from the active theme's registry; unknown section types render nothing (forward compatibility when themes evolve).

### 2.1 Standard Page Catalog (v1)

The default theme ships these pages, seeded at tenant provisioning ([`multi-tenancy.md`](multi-tenancy.md) §7); tenants can add, reorder, hide, or edit any of them through the CMS:

| Page | Primary sections | Data source |
| ---- | ---------------- | ----------- |
| Homepage | Hero, AdmissionsCTA, NewsList, EventsList, Gallery | CMS + live modules |
| About School | AboutSchool, PrincipalMessage | CMS content |
| Departments | DepartmentsGrid | Academic module (published entries) |
| Teachers | TeachersGrid | Staff module (opt-in published profiles only) |
| Classes | ClassesList | Academic module |
| Admissions | AdmissionsCTA, admission-enquiry form | CMS + Admissions module |
| Events / News / Notices | EventsList, NewsList, NoticeBoard | Communication module (public-flagged items) |
| Gallery | Gallery | CMS media |
| Contact | ContactForm, map/address | CMS + public form endpoint |

Staff and student data appear on the public site **only** when explicitly marked public by the tenant — the default for all personal data is private.

## 3. Data Access & Caching

- The renderer calls the API with a **scoped machine token** limited to `website.public-content.view` — read-only, public-published content only, per [`api-architecture.md`](api-architecture.md) §2.2. Draft pages are visible only through an authenticated preview mode (short-lived signed preview URL from the dashboard).
- **Rendering strategy: ISR (Incremental Static Regeneration)** per tenant + path (recommendation). Pages render on first request, are cached at the edge, and revalidate on a modest TTL (e.g. 5 minutes) as a safety net.
- **Publish-time invalidation:** when a tenant publishes CMS changes (or module data that feeds a section changes — a new notice, event, or news post), the API emits a `website.content_published` event; a webhook to the renderer triggers on-demand revalidation for the affected tenant's paths. Result: edits go live in seconds without cold-rendering every request.
- Per-tenant cache keys always include the resolved tenant ID — a cache entry can never be served across hosts.

## 4. SEO

- **Per-page meta:** title, description, canonical URL, Open Graph/Twitter card image — editable per page in the CMS, with sensible defaults from school branding.
- **`sitemap.xml` and `robots.txt`** generated per tenant (per host) from published pages; unpublished/suspended sites emit `noindex`.
- **Structured data:** JSON-LD `School`/`EducationalOrganization` on the homepage, `Event` for events, `NewsArticle` for news posts (recommendation).
- Server-side rendering guarantees crawlable HTML; Core Web Vitals budgets and accessibility requirements are defined in [`../07-quality/non-functional.md`](../07-quality/non-functional.md).
- Custom domains are the canonical host when active (subdomain 301-redirects to it) to avoid duplicate-content penalties.

## 5. Future Multi-Theme Model

Designed now, shipped later (scope §11 "WordPress-style" direction):

- A **theme registry** in code: each theme exports its section-component set, token contract, and a manifest (name, preview screenshots, supported section types). Themes are platform code — **no per-tenant custom code, ever** (isolation and supportability boundary).
- Tenants get a **theme selection** setting; switching themes re-renders the same `website_pages`/`page_sections` content through the new theme's components. Section-type schemas are theme-independent, so content survives theme switches; a theme lacking a section type simply skips it.
- New themes are added by shipping code + registry entry; no migration of tenant content is required. Per-theme token extensions must declare defaults so existing branding maps cleanly.

## 6. Security Boundary

The public renderer is treated as a **zero-write, minimum-privilege client**:

- Its machine token cannot write anything and cannot read non-public data; compromise of the renderer exposes only already-public content.
- **Public forms** (admission enquiry, contact) POST from the browser **directly to public API endpoints** (`POST /api/v1/public/admission-enquiries`, `POST /api/v1/public/contact-messages`) — not through the renderer's token. These endpoints are:
  - tenant-resolved server-side from the submitted host/tenant slug and re-validated,
  - aggressively rate-limited per IP and per tenant, with CAPTCHA escalation on abuse (recommendation),
  - strictly validated and size-limited, feeding the Admissions and Communication modules as leads/messages,
  - idempotency-protected against duplicate submissions ([`api-architecture.md`](api-architecture.md) §2.5).
- No authentication cookies exist on public sites; the renderer and dashboard run on separate origins so no session can bleed between them.
- Uploaded media (gallery images, documents) are served from tenant-prefixed object storage via the CDN with public-read only for explicitly published assets.

## 7. Request Flow Summary

1. Browser requests `https://<host>/admissions`.
2. Edge/CDN serves the cached ISR page if fresh — most traffic terminates here.
3. On miss: renderer middleware resolves Host → tenant (cached lookup) and rejects unknown/suspended hosts.
4. Renderer fetches page + section data from the public content API (machine token), renders with the tenant's theme tokens, stores the result in the ISR cache keyed by `(tenant_id, path)`, and responds.
5. A later CMS publish fires the revalidation webhook; affected paths re-render on next request.

Performance targets (LCP, TTFB, availability) for public sites are defined in [`../07-quality/non-functional.md`](../07-quality/non-functional.md); because pages are static-served between publishes, public traffic places near-zero load on the API and database.

## 8. Component Summary

| Concern | Owner |
| ------- | ----- |
| Page/section content editing, publish workflow | Website CMS module (dashboard) — [`../03-modules/website-cms.md`](../03-modules/website-cms.md) |
| Rendering, theming, ISR, SEO output | `apps/website` renderer (this document) |
| Public content read API + public form endpoints | `schoolhub-api` ([`api-architecture.md`](api-architecture.md)) |
| Domain verification, TLS automation | Platform infrastructure ([`hosting-deployment.md`](hosting-deployment.md)) |
| Branding tokens | Tenant configuration ([`multi-tenancy.md`](multi-tenancy.md) §5) |
