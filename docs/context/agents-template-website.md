# AGENTS.md — schoolhub-frontend-v2 / apps/website (template)

> Copy this file to the public-website renderer app root as `AGENTS.md` when the repo is created, and fix the `DOCS` path/URL.

Instructions for AI assistants working on the **SchoolHub public school website renderer** — the multi-tenant Next.js app that serves every school's public website (wildcard subdomains + custom domains).

## Required Reading, In Order

`DOCS = <path or URL of the schoolhub-srd docs repo>`

1. `DOCS/AGENTS.md` — project summary, locked vocabulary, invariants. Always.
2. `DOCS/docs/02-architecture/website-builder.md` — the rendering architecture: Host-header tenant resolution, theme system, ISR + publish invalidation, SEO, security boundary. This is your primary spec.
3. `DOCS/docs/03-modules/website-cms.md` — the functional spec of pages, sections, navigation, news/events/gallery, forms.
4. `DOCS/docs/05-database/entities/website-cms.md` — the content schema you read.

## Hard Rules

1. **Read-only:** this app holds a scoped machine token with read-only public-content permissions. It never writes tenant data. The only POSTs are the public form endpoints (`/api/v1/public/...` — contact, admission enquiry), which are rate-limited and CAPTCHA-protected server-side.
2. **Tenant resolution is the security boundary:** every data fetch is scoped to the tenant resolved from the Host header; never accept a tenant identifier from query params or cookies.
3. **Never leak private data:** only entities the CMS marks publishable (e.g. `show_on_website`) may render. No student or guardian PII, ever.
4. **Themes:** one theme at launch — a set of section components driven by theme tokens from tenant branding. No per-tenant code; new themes register in the theme registry (`website-builder.md` future model).
5. **SEO & performance:** per-page meta, sitemap.xml, robots, structured data; ISR with publish-webhook invalidation — no per-request rendering of unchanged content.
6. **Accessibility:** WCAG 2.1 AA; websites are parent-facing public pages.
