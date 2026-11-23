<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — schoolhub-frontend / apps/website

Instructions for AI assistants working on the **SchoolHub public school website renderer** —
the multi-tenant Next.js app that serves every school's public website (wildcard subdomains +
custom domains).

Read the monorepo root [`../../AGENTS.md`](../../AGENTS.md) first — it holds the repo-wide rules.

## Required Reading, In Order

`DOCS = <repo root>/docs`

1. `DOCS/AGENTS.md` — project summary, locked vocabulary, invariants. Always.
2. `DOCS/02-architecture/website-builder.md` — the rendering architecture: Host-header
   tenant resolution, theme system, ISR + publish invalidation, SEO, security boundary. This is
   your primary spec.
3. `DOCS/03-modules/website-cms.md` — the functional spec of pages, sections, navigation,
   news/events/gallery, forms.
4. `DOCS/05-database/entities/website-cms.md` — the content schema you read.

## Hard Rules

1. **Read-only:** this app holds a scoped machine token with read-only public-content
   permissions. It never writes tenant data. The only POSTs are the public form endpoints
   (`/api/v1/public/...` — contact, admission enquiry), which are rate-limited and
   CAPTCHA-protected server-side.
2. **Tenant resolution is the security boundary:** every data fetch is scoped to the tenant
   resolved from the Host header; never accept a tenant identifier from query params or cookies.
3. **Never leak private data:** only entities the CMS marks publishable (e.g. `show_on_website`)
   may render. No student or guardian PII, ever.
4. **Themes:** one theme at launch — a set of section components driven by theme tokens from
   tenant branding. No per-tenant code; new themes register in the theme registry
   (`website-builder.md` future model).
5. **SEO & performance:** per-page meta, sitemap.xml, robots, structured data; ISR with
   publish-webhook invalidation — no per-request rendering of unchanged content.
6. **Accessibility:** WCAG 2.1 AA; websites are parent-facing public pages.

## How This App Is Wired

| Concern                                     | Where                                                                                                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host → tenant classification (edge)         | `src/proxy.ts` + `src/lib/host.ts` (pure, tested; `/api/revalidate` and `/api/preview` pass on any host)                                                                                                                     |
| Subdomain → custom-domain 301               | `src/app/layout.tsx`, after the cached `resolveTenant()` (`customDomainRedirectTarget`); never in the proxy, which stays I/O-free                                                                                            |
| Authoritative tenant lookup, cached         | `src/lib/tenant.ts` — `status`/`website_status` → active, unavailable (neutral notice) or unknown                                                                                                                            |
| Read-only transport (machine token)         | `src/lib/api.ts` — has **no** write method by design                                                                                                                                                                         |
| Public content reads                        | `src/lib/content.ts` — every export is a read                                                                                                                                                                                |
| Page rendering (sections → components)      | `src/app/render-page.tsx`, `src/app/[...slug]/page.tsx`, `src/app/page.tsx`; shared chrome and the unavailable notice in `src/app/site-shell.tsx`                                                                            |
| News, event and album detail pages          | `src/app/news/[slug]`, `src/app/events/[slug]`, `src/app/gallery/[slug]`; JSON-LD only through `src/components/json-ld.tsx` (`serializeJsonLd` escapes `<`, `>`, `&`, U+2028/2029 — the app's one `dangerouslySetInnerHTML`) |
| Rich text                                   | `src/themes/default/rich-text-blocks.tsx` — block documents as React elements, never HTML                                                                                                                                    |
| Preview (Draft Mode)                        | `src/app/api/preview/route.ts` validates the token with the API, then sets Draft Mode and the token cookie; `src/lib/preview.ts`; `pages`/`site` reads send it uncached; exit at `src/app/api/preview/exit/route.ts`         |
| Image optimiser allow-list                  | `next.config.ts` → `src/lib/image-config.ts` (the public API file route only) and `src/lib/env.build.ts` (`WEBSITE_IMAGES_UNOPTIMIZED`, compose and E2E only)                                                              |
| Visible strings                             | `src/themes/default/copy.ts` (English; one map for a later i18n pass)                                                                                                                                                        |
| Theme registry + token contract             | `src/themes/index.ts`, `src/themes/default/`                                                                                                                                                                                 |
| Publish invalidation webhook (HMAC)         | `src/app/api/revalidate/route.ts` — the signer's `tenant:<id>…` tags, plus `tenant-host:<host>`                                                                                                           |
| Unknown host landing                        | `src/app/platform-landing/page.tsx` (the proxy rewrites here)                                                                                                                                                                |
| Configuration                               | `src/lib/env.ts` (server: secrets, platform domain — never import from a client component) · `src/lib/env.client.ts` (public `NEXT_PUBLIC_*` only, all optional)                                                             |
| Public form submission (the one write path) | `src/lib/public-api.ts` — browser → public API, endpoint registry; never through `api.ts`                                                                                                                                    |
| Imports and lint baseline                   | `@/…` alias only (ESLint bans `../` outside tests); `eslint-suppressions.json` may only shrink (ADR-0014)                                                                                                                    |

### The rules those files encode

- Adding a write helper to `src/lib/api.ts` or `src/lib/content.ts` is a **security
  regression**, not a feature. Browser → public API is the only write path.
- The proxy **deletes** inbound `x-schoolhub-*` headers before setting its own; without
  that, a client could hand us a header and read another school's site.
- Cache tags are `tenant:<id>…` or a host tag (`tenant-host:<host>`); the revalidate webhook
  accepts `tenant:` tags only inside the tenant that signed the request.
- Preview is the httpOnly `schoolhub_preview` token cookie alone, set only by `/api/preview`
  after the API accepted the token; it redirects only to the path the API returned. Never use
  Next's Draft Mode: its `__prerender_bypass` cookie is build-wide, so it would work on every
  school's host. Only `pages` and `site` send the token, uncached, and fall back to the cached
  published read when the API refuses it.
- An unknown or suspended host renders the platform notice or a 404 — **never** another
  tenant's content, and never with `index: true`.

## Adding a Section Type

1. The type is declared by the API's theme (`apps/api/apps/website_cms/themes/default.json`)
   and reaches this app as the generated `SectionTypeEnum` (`@schoolhub/api-client`). The
   registry in `src/themes/default/index.ts` is a `Record` over that enum, so a new type fails
   `tsc` here until it is registered (`null` = declared but not rendered yet).
2. Create `src/themes/default/sections/<kebab-name>.tsx`; validate `section.props` with Zod
   against the theme's JSON schema (image ids arrive as `<name>_url`) and return `null` when it
   does not match — a bad payload must not take the page down.
3. Register it in `src/themes/default/index.ts` in place of its `null`.
4. Live module data goes through a read function in `src/lib/content.ts` that sends the
   request's `host` and carries tenant cache tags.

Wire types come from `ApiSchemas` (`@schoolhub/api-client`, ADR-0005/0017), never hand-written:
`PublicTenant`, `PublicPage`, `PublicSite` and the list item types. `TenantBranding`
(`@schoolhub/types`) stays only as the token contract's input.

Tests: Jest + React Testing Library, co-located in a sibling `__tests__/` folder (`__tests__/*.test.ts(x)`), not `*.test.ts(x)` flat beside the source. Browser-level coverage
lives in `e2e/` (Playwright). Note the limit: this app renders on the server, so a browser
stub cannot intercept its fetches — the mocked `website` project covers only what the proxy
decides before any fetch (host resolution, the unknown-host fallback, header stripping).
Rendered tenant content needs the real stack and belongs in the E2E `live` lane.

## Guidance To Load First

Before writing or reviewing code here, load the Vercel skill that matches the work:
`react-best-practices` for performance (waterfalls, bundle size, re-renders),
`next-best-practices` for route conventions, RSC boundaries and data fetching,
`next-cache-components` for caching and PPR, and `web-design-guidelines` for
accessibility review. They are installed on this machine and outrank generic
advice on framework questions; this app's own conventions still win over both.
