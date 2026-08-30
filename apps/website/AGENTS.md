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
2. `DOCS/docs/02-architecture/website-builder.md` — the rendering architecture: Host-header
   tenant resolution, theme system, ISR + publish invalidation, SEO, security boundary. This is
   your primary spec.
3. `DOCS/docs/03-modules/website-cms.md` — the functional spec of pages, sections, navigation,
   news/events/gallery, forms.
4. `DOCS/docs/05-database/entities/website-cms.md` — the content schema you read.

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

| Concern | Where |
| ------- | ----- |
| Host → tenant classification (edge) | `src/proxy.ts` + `src/lib/host.ts` (pure, tested) |
| Authoritative tenant lookup, cached | `src/lib/tenant.ts` |
| Read-only transport (machine token) | `src/lib/api.ts` — has **no** write method by design |
| Public content reads | `src/lib/content.ts` — every export is a read |
| Page rendering (sections → components) | `src/app/render-page.tsx`, `src/app/[...slug]/page.tsx`, `src/app/page.tsx` |
| Theme registry + token contract | `src/themes/index.ts`, `src/themes/default/` |
| Publish invalidation webhook (HMAC) | `src/app/api/revalidate/route.ts` |
| Unknown host landing | `src/app/_platform/page.tsx` (the proxy rewrites here) |

### The rules those files encode

- Adding a write helper to `src/lib/api.ts` or `src/lib/content.ts` is a **security
  regression**, not a feature. Browser → public API is the only write path.
- The proxy **deletes** inbound `x-schoolhub-*` headers before setting its own; without
  that, a client could hand us a header and read another school's site.
- Cache tags are always `tenant:<id>…`, and the revalidate webhook only accepts tags inside the
  tenant that signed the request.
- An unknown or suspended host renders the platform notice or a 404 — **never** another
  tenant's content, and never with `index: true`.

## Adding a Section Type

1. Add the type to `SECTION_TYPES` in `packages/types/src/website.ts`.
2. Create `src/themes/default/sections/<kebab-name>.tsx`; validate `section.props` with Zod and
   return `null` when it does not match — a bad payload must not take the page down.
3. Register it in `src/themes/default/index.ts`. Unregistered types render nothing on purpose.
4. Live module data goes through a read function in `src/lib/content.ts` with tenant cache tags.

Tests: Jest + React Testing Library, co-located as `*.test.ts(x)`. Browser-level coverage
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
