# Website & CMS: Implementation Plan

> **For agentic workers:**
> - REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or superpowers:executing-plans). Steps use `- [ ]`.
> - Per task: one implementer pass. Per PR: one `change-reviewer` pass with this plan, and one fix pass.
> - **Never run tests, lint, typecheck or `manage.py` locally** (ADR-0007). Push, then read `gh pr checks <n> --watch` / `gh run view <id> --log-failed`.
> - Generators are not checks and must run whenever a contract changes (L2): `apps/api/scripts/generate-openapi.sh`, then `pnpm --filter @schoolhub/api-client generate`.
> - Every subagent brief carries the L11 overrides and `docs/07-quality/agent-lessons.md` §2: no local test/lint/typecheck runs; stage only your own files, by path; never touch `.env*`; no AI attribution; never `--no-verify`; `fix` commits carry `Root cause:`; write the report early.
> - Load skills per task: `schoolhub-backend-module` + `schoolhub-testing` (API), `schoolhub-api-services` + `schoolhub-dashboard-screen` (dashboard), `next-best-practices` + `next-cache-components` (renderer), `schoolhub-ui-port` only if a new `packages/ui` primitive is needed.
> - Library mechanics come from Context7, version-matched: `jsonschema`, `dnspython`, `django-cors-headers` (`check_request_enabled` signal), Next 16 `draftMode` / `revalidateTag`, `@dnd-kit/sortable`.

**Work tier:** 2

**Goal:** Every school gets a working public website managed from the dashboard:
- staff compose pages from the theme's typed sections, and publish news, events and galleries;
- they edit navigation, site settings and SEO;
- they bind a custom domain;
- they triage contact-form submissions.

The existing `apps/website` renderer serves all of it from a real, read-only public content API.

**Architecture:**
- **Backend.** A new Django app, `apps/api/apps/website_cms/`, built on the module spine every shipped app uses: `TenantOwnedModel` with RLS, code-declared permission, feature, upload and notification registries, fat services with thin viewsets, and ADR-0010 resource packages.
- **Two API surfaces:**
  - the **authenticated CMS API** (JWT);
  - the **public content API** under `/api/v1/public/`. The renderer reads it with a platform machine token scoped to `website.public-content.view`. The API resolves every read's tenant itself from a `host` parameter, so the renderer never asserts a tenant.
- **Media** is served through a stable redirect endpoint that honours `files.visibility`.
- **Rich text** is a constrained block document validated by JSON Schema, so it is XSS-free by construction.
- **Cache.** Publishing enqueues an HMAC-signed revalidation webhook to the renderer's existing `/api/revalidate` route.
- **Custom domains** live in this app. A platform-scope route table answers host → tenant without any cross-tenant read under RLS.
- **Renderer.** It moves from hand-written types to the generated contract.
- **Dashboard.** It gains a "Website" area, and its section forms are generated from the theme's JSON schemas.

**Tech stack:**
- Python 3.14, Django 6.1, DRF, drf-spectacular, Celery 5.6, PostgreSQL 18 (RLS);
- new runtime deps: `jsonschema` (moved from dev to runtime) and `dnspython`;
- Next.js 16 / React 19, TanStack Query and Table, react-hook-form + zod, next-intl, `@dnd-kit/sortable` (already a dashboard dep);
- Jest + RTL, Playwright (mocked `dashboard` project, mocked `website` project, nightly `live` lane).

**Spec:**
- `docs/03-modules/website-cms.md`: §4 keys, §5–6 features, §7 workflows, §11 validations, §12 notifications, §13 reports, §16 endpoints, §19 recommendations.
- `docs/05-database/entities/website-cms.md`.
- `docs/05-database/entities/tenancy.md`: `custom_domains`, `files`.
- `docs/02-architecture/website-builder.md`.
- `api-architecture.md` §2.2: machine tokens.
- ADRs 0005/0017 (generated contract), 0010 (layout), 0013 (cross-app deps), 0014 (no hardcoding), 0021 (scoped downloads), 0027 (`AnyOf`), 0034 (adapter + fake pattern).

**Plan file in the repo:** PR A's first commit adds this plan, with its review block, as `docs/superpowers/plans/2026-11-15-website-cms.md`.

**Workspace:** a worktree, `git worktree add ../schoolhub-website -b feat/website-cms-foundation origin/main`, because another session is building platform-admin in the main checkout. Per L21, run `pnpm install` and `uv sync` **inside the worktree**, and before each push confirm `node -p "require.resolve('@schoolhub/api-client')"` resolves inside it, not in the main checkout.

**ADR numbers:** 0035–0037 are claimed by #182 and platform-admin, so this plan reserves **0038** (block rich text and schema-validated sections) and **0039** (the public content API: machine clients, host-resolved tenancy, media redirect, custom-domain ownership and route table, and the `public.py` cross-app read convention).

---

## Context

**Why now.** website-cms is Tier 5's other module. Platform-admin, the Tier 5 sibling, is in flight in another session.

**What exists on `main`:**
- **`apps/website` renderer: built, but running against an API that does not exist.**
  - It reads 11 GET paths: `src/lib/content.ts`, `tenant.ts`; the contract is in `packages/types/src/website.ts` and `tenant.ts`.
  - It sends a bearer `WEBSITE_MACHINE_TOKEN`.
  - Its browser forms POST to `/public/contact-messages` and `/public/admission-enquiries` with `X-Tenant-Slug` and `Idempotency-Key`.
  - It verifies an HMAC webhook at `src/app/api/revalidate/route.ts`.
  - `e2e/tests/live/website-tenant-resolution.spec.ts` pins today's degraded behaviour: a seeded host renders not-found.
- **API: no machine auth and no public content endpoints.**
  - The only auth class is JWT (`config/settings/base.py:233`).
  - The only public precedents are the payment callback (`apps/fees_finance/views.py:1100`: `AllowAny`, an inline tenant lookup, `tenant_atomic`) and `EmailedLinkView` (`core/rbac/link_views.py`).
  - `PublicFormThrottle` (`core/api/throttling.py:52`) exists but is unused.
  - `test_endpoint_contracts.py` exempts `api/v1/public/`.
- **Reusable pieces:**
  - `replay_or_execute` (`core/idempotency/services.py:48`), keyed per tenant and fine for anonymous callers;
  - `tenant_atomic` (`core/tenancy/context.py:79`);
  - `operational_tenant` (`core/tenancy/access.py:23`);
  - `for_each_tenant` (`core/tenancy/maintenance.py:41`);
  - `get_display_url` (`core/files/services.py:180`);
  - the upload registry (`core/files/purposes.py`);
  - `notify()` with the catalog and templates (`core/notifications/`);
  - `record_audit` (`core/audit/services.py:79`);
  - `TenantScopedViewSetMixin` and `AnyOf`.
- **Gaps in other modules:**
  - `Staff` has only `public_bio`, no opt-in flag;
  - `Department` and `Class` have no public flag;
  - communication's `Announcement`/`Notice` already carry `show_on_website` (`apps/communication/models.py:171,238`), with no public feed;
  - `FileVisibility.PUBLIC` exists but nothing reads it;
  - presigned display URLs live 1 h, which breaks ISR caching;
  - CORS does not allow `X-Tenant-Slug` or tenant origins.
- **Dashboard:** nothing exists except the unused i18n key `nav.website`.
- **Spec conflicts this plan resolves** (each gets a doc update in its PR):
  1. The public paths differ between spec §16 and the renderer. The final contract is below.
  2. Tenant status: the renderer's `closed` becomes the API's `deprovisioned`.
  3. The teacher opt-in flag is missing; this plan adds it.
  4. The renderer says events come from communication, but the spec owns `school_events`, so this plan follows the spec.
  5. `custom_domains` ownership is split between docs. Decision 7 settles it.
  6. Spec §12 template refs (`web-contact-received`) break the locked vocabulary. They become `website.contact-received`.

## Decisions

| # | Decision | Choice |
| - | -------- | ------ |
| 1 | Renderer auth | **The machine client.** One platform machine client. `MACHINE_CLIENTS = {"website-renderer": {"tokens_setting": "WEBSITE_MACHINE_TOKENS", "scopes": ["website.public-content.view"]}}`. **Tokens.** `WEBSITE_MACHINE_TOKENS` is a comma-separated list, newest first, so a token rotates with overlap, mirroring `INTEGRATIONS_ENCRYPTION_KEYS`. It is compared with `hmac.compare_digest` and fails closed when empty. **Classes.** `MachineTokenAuthentication`, `HasMachineScope` and `MachineClientThrottle` live in `core/rbac/machine.py`. They are set **per view**, never in `DEFAULT_AUTHENTICATION_CLASSES`. **The scope is not a role permission.** It lives in `MACHINE_SCOPES` in `core/rbac/machine.py`, so no grantable `Permission` row is synced; this avoids platform-admin's per-key `scope` work. A contract test asserts that every machine-guarded view's scope is in `MACHINE_SCOPES` |
| 2 | Tenant on public reads | Every public read takes `?host=`. `website_cms.hosts.resolve_host(host) -> Tenant \| None` matches a single label under `PLATFORM_DOMAIN` by slug, otherwise an active `custom_domain_routes` row. Every read 404s when the tenant is not operational, `module.website` is off, or the site is unpublished or in maintenance. `by-host` is the exception: it returns the tenant with `status` and `website_status`. A tenant with no `website_settings` row counts as `unpublished` |
| 2a | Throttling public reads | `PublicContentView.throttle_classes = [MachineClientThrottle]`, scope `machine_client`, keyed `client:host`. The rate is 1200/min per host, sized from about 8 reads per page render with ISR misses only. This replaces the defaults, whose `UserRateThrottle` would key on a principal with no `pk`. Anonymous throttles depend on a new `NUM_PROXIES` setting read from env; its default `None` keeps today's behaviour, and the stored `contact_submissions.ip` uses the same client-IP derivation |
| 3 | Public contract | See "Public API contract" below. Spec §16 and website-builder.md are updated to match |
| 4 | Media | **The endpoint.** `GET /public/files/{tenant_id}/{file_id}` is anonymous. It serves only `status=ready, visibility=public` files, answering 302 to a presigned display URL with `Cache-Control: public, max-age=300`. Its throttle, `PublicFileThrottle` (scope `public_file`, 120/min), is keyed per **(IP, file)**, so the renderer's image optimiser, which fetches every image from one IP, is never starved. **References.** File references are derived from the schema: every property with `x-widget: image` (including the image block's `file_id`). `media.py` emits each as `<name>_url` with the redirect URL, built on the existing `API_PUBLIC_URL`. **Visibility is recomputed, never only flipped.** `sync_file_visibility(file_ids)` makes a file `public` iff at least one published row references it (pages via sections, news, events, gallery items, SEO OG images, or an opted-in staff photo), else `private`. It runs on every publish, unpublish, archive, delete and content or photo replace, and on every path that ends a staff record. It uses a new `core.files.services.set_visibility(file, visibility)`. Drafts stay private; preview reads them under the preview token |
| 5 | Rich text | A block document `{"blocks":[...]}` whose block types are `paragraph`, `heading` (levels 2–4), `list` (ordered/unordered), `quote` and `image` (`file_id`, `alt`). Schema: `website_cms/schemas/rich_text.json`. It is used by news `body`, event `description` and the `rich_text` section. The renderer and dashboard never use `dangerouslySetInnerHTML` |
| 5a | Links | Every URL-bearing field uses the custom format **`safe-url`**: an `https:` URL or a `/`-relative path not starting `//`. That covers schema link fields, `social_links`, `header_config`/`footer_config` links, `canonical_url`, `embed_url` and nav `url` targets. It is checked by a `FormatChecker` that the validator is **explicitly** given, and the same function backs every serializer `URLField` replacement. `format: uri` is not used, because jsonschema skips formats without a checker and RFC 3986 accepts `javascript:` |
| 6 | Section schemas | **The theme file.** `website_cms/themes/default.json` (code `default`, version `1.0.0`) declares each section type's JSON Schema in a constrained subset: `type`, `properties`, `required`, `items`, `enum`, `maxLength`, `format: safe-url`, `$ref` to rich text, and an `x-widget` hint from `text`, `textarea`, `image`, `rich-text` or `url`. **Syncing.** Code-declared themes sync into `themes` on `post_migrate` (reusing `sync_feature_flags_on_migrate`'s pattern, `core/tenancy/features.py:162`), so a theme edit needs no data migration (spec §5.10). Theme v1 has the renderer's 12 types plus `rich_text` and `faq`. Validation uses `jsonschema.Draft202012Validator`. **Drift.** `section_type` is emitted as an OpenAPI enum. The renderer's registry is typed `Record<ApiSchemas["SectionTypeEnum"], …>`, so `tsc` catches any drift |
| 7 | Custom domains | Owned by `website_cms`: it has the `website.*` keys, the website is its only consumer, and putting it in `core.tenancy` would collide with platform-admin's in-flight `core.tenancy` migrations. `custom_domains` is a `TenantOwnedModel` with RLS and `unique(tenant, domain)` among live rows. `custom_domain_routes(domain unique, tenant_id, custom_domain_id)` is a platform-scope table with no RLS, holding only active domains. Services write it in the same transaction as activation, disable or delete. This is the same denormalised read model platform-admin chose (its alternative 2). Verification is DNS TXT `_schoolhub-verify.<domain>` = token, plus a CNAME check to `WEBSITE_CNAME_TARGET`, behind a `DnsVerifier` adapter (`dnspython` real, fake for tests). TLS sits behind an `EdgeCertificateProvisioner` adapter whose v1 `NullProvisioner` leaves `tls_status=pending`. Adapter selection follows ADR-0034 |
| 8 | Revalidation | **Scope.** Whole-tenant invalidation on any publish, unpublish or settings change. **Mechanism.** `queue_revalidation(tenant_id, extra_tags=())` runs on commit, and a Celery task POSTs `{tenant_id, tags}` signed with HMAC-SHA256, with 5 retries and backoff. **Settings.** It reads the API settings `WEBSITE_REVALIDATE_URL` and `WEBSITE_REVALIDATE_SECRET`; the latter is mapped in compose from the existing `${REVALIDATE_SECRET}`, the same variable the website service reads, so there is one secret. An empty URL makes it a no-op. **Host tags.** Changes to settings, the module flag or domains also add `tenant-host:<h>` for **every** host of the tenant (its subdomain and its active domains), so `by-host`'s 300 s cache never serves a stale `website_status`. The renderer route learns to accept these tags. The URL targets the renderer's internal origin (compose: `http://website:3000/api/revalidate`), and the proxy exempts `/api/revalidate` and `/api/preview` from the unknown-host rewrite |
| 9 | Preview | **The token.** `POST /website-pages/{id}:preview` (`website.page.view`) returns a URL on the tenant's own host: the primary active domain, else `<slug>.<PLATFORM_DOMAIN>`. It is built by `website_cms/urls.py::tenant_site_url(tenant, path)`, modelled on `core/tenancy/urls.py`, and carries a `TimestampSigner` token (salt `website-preview`, `max_age` 600 s, payload `tenant_id:page_id`). **Validation.** The renderer's `/api/preview` validates first: it calls `GET /public/pages?host=` with header `X-Preview-Token` (never a query string, SEC-57). Only on a 200 does it store the token in an httpOnly, Secure, `SameSite=Lax` cookie with a 600 s max-age, and redirect to the **slug the API returned**. That prevents an open redirect. **The cookie is the only switch; Next's `draftMode` is not used** (amended in the PR E review): its `__prerender_bypass` cookie is one value for the whole build, so it would unlock uncached renders on every school's host and cannot be scoped to one tenant. Under the cookie only the `pages` and `site` reads send the token as `X-Preview-Token` with `cache: "no-store"`; a refused (404) or throttled (429) preview read falls back to the cached published read, and every other read stays cached. The API counts `X-Preview-Token` reads on `pages` and `site` per (machine client, host) in `PublicPreviewThrottle` (scope `public_preview`, 60/min), which replaces the per-host machine quota for such a read, so forged cookies can exhaust only that school's previews. `/api/preview/exit` (a `POST`) clears the cookie, and a banner shows while it is held. website-builder §6's "no cookies" line is amended to allow this one cookie |
| 10 | Default site | **What it creates.** `services.ensure_default_site(tenant)` is idempotent: `get_or_create` against `unique(tenant_id)` inside a savepoint, with an `IntegrityError` re-read. It creates `website_settings` (theme `default`, unpublished) and the eight standard pages as drafts, each with placeholder sections and `home` as homepage. **Who calls it.** It is called **only from writes and the seed**: the first `PATCH /website-settings`, the first page create, and `seed_e2e_website`. **GETs never write.** `GET /website-settings` returns an unsaved default with `exists: false` when no row exists, and `GET /navigation-menus` returns empty menus. Platform-admin's `provision_tenant` can call it later (a follow-up in deferred-work) |
| 11 | Other modules' data | Each owner exposes a read-only `public.py`: `staff_management.public.public_teachers(limit)`, `school_organization.public.public_departments()`, `public_classes()`, `primary_campus_contact()`, and `communication.public.public_notices(limit)`. New opt-in booleans `Staff.show_on_website`, `Department.show_on_website` and `Class.show_on_website` default to `false`. Turning a staff member's flag on or off sets their photo file's visibility |
| 12 | Dashboard section forms | One schema-driven `SchemaFields` component renders the subset from decision 6, so a new theme or section type needs no dashboard code |
| 12a | Dashboard reachability | Each Website section is gated by its own key in `features/website/website-sections.ts`, rendered through `sectionMenuItems` (the pattern `communication-sections.ts` uses):<br>• pages, news, events and gallery: `website.page.view`<br>• navigation: `website.navigation.update`<br>• settings: `website.settings.update`<br>• SEO: `website.seo.update`<br>• domains: `AnyOf(custom-domain.create, .update)`<br>• contact inbox: `website.contact-submission.view`<br>The group shows when any section is visible, so `reception` and `school_owner` reach their sections |
| 13 | Reads in the CMS | §4 has no view key for news, events or galleries, so `website.page.view` is the CMS read key for all website content (stated in §4). Custom-domain reads use `AnyOf("website.custom-domain.create", "website.custom-domain.update")` |
| 14 | Slugs | Page slugs match `^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$` with max 120 characters. The first segment must not be in `RESERVED_PAGE_SLUGS = {"admin","api","verify","news","events","gallery","notices","preview","sitemap.xml","robots.txt"}` (`website_cms/constants.py`). News, event and album slugs are single-segment. Uniqueness uses partial unique indexes on `deleted_at IS NULL`, and pages use `nulls_distinct=False` on `locale` |

### Public API contract (all under `/api/v1/public/`)

| Method + path | Auth | Returns |
| ------------- | ---- | ------- |
| `GET tenants/by-host?host=` | machine | `PublicTenant`: id, slug, name, status, `website_status` (`live`/`maintenance`/`unpublished`), branding (from `TenantSettings.branding`), locale, contact (primary campus), `custom_domain` (primary active), enabled_modules |
| `GET site?host=` | machine | `PublicSite`: theme code/version/config, navigation (header, footer_primary, footer_secondary, unpublished targets dropped), header/footer config, social links, site SEO |
| `GET pages?host=&slug=` (draft via `X-Preview-Token` header) | machine | `PublicPage`: empty slug or `home` returns the homepage; visible sections only, in order, as `{id, type, position, props}`; SEO |
| `GET sitemap?host=` | machine | `[{path, updated_at}]` for published pages (`show_in_search`), news posts, events and albums |
| `GET news-posts?host=&page_size=` · `GET news-posts/{slug}?host=` | machine | List (max 50, newest first) and detail with rich-text body |
| `GET school-events?host=&scope=upcoming\|past&page_size=` · `GET school-events/{slug}?host=` | machine | `upcoming` (the default) is `coalesce(ends_at, starts_at) >= now` |
| `GET gallery-albums?host=` · `GET gallery-albums/{slug}?host=` · `GET gallery-items?host=&page_size=` | machine | Albums, an album with its items, and the latest images across published albums (for the `gallery` section) |
| `GET teachers` · `departments` · `classes` · `notices` `?host=` | machine | Opted-in records only; notices are published, `show_on_website`, unexpired, with plain-text body |
| `GET files/{tenant_id}/{file_id}` | anonymous | 302 to a presigned URL, or 404 |
| `POST contact-submissions` | anonymous, `X-Tenant-Slug` (plus `Origin` when present), `Idempotency-Key` | 201 `{status:"received"}` |

The admission-form endpoint is deferred to the admissions module. Until then the renderer's admissions-enquiry form posts as a contact submission with `subject="Admission enquiry"`.

## Alternatives considered (why not)

1. **Anonymous public reads with no machine token.** Rejected. The spec's security boundary (website-builder §6, api-architecture §2.2) makes the renderer a scoped principal, and an open read API invites enumeration and scraping of every tenant. The token costs one header.
2. **Per-tenant machine tokens.** Rejected. One renderer deployment serves every tenant, so it would have to hold N secrets, and provisioning would need secret distribution.
3. **The renderer passes a resolved `tenant_id`.** Rejected in favour of `host`. The API stays the single tenancy resolver, so a renderer bug cannot assert the wrong tenant, and a spoofed host only reaches another tenant's already-public content.
4. **A public bucket or CDN prefix for media.** Rejected for v1: it needs bucket-policy and object-copy infrastructure. The redirect gives stable, cacheable URLs today, honours the existing `FileVisibility`, and a CDN can front `/public/files/` later without a contract change.
5. **HTML rich text plus a sanitizer (`nh3`).** Rejected. Sanitizer bypasses are a recurring CVE class, while a block document cannot carry markup at all. It also matches the entity's `jsonb` type.
6. **A hand-built dashboard form per section type.** Rejected. It contradicts spec §5.10: new themes must ship without per-tenant or per-type code paths.
7. **`custom_domains` in `core/tenancy` or `platform_admin`.** Rejected, for the reasons in decision 7. The cross-tenant host lookup alternatives were also rejected: a `SECURITY DEFINER` function, a `BYPASSRLS` role, or a policy clause each widen invariant 1's surface, and platform-admin's plan already rejected them.
8. **Global `unique(domain)` across claims, as the entity doc has it.** Rejected. A tenant could squat a domain it doesn't own by leaving it `pending_dns`. Global uniqueness applies only to active routes, and DNS proof decides.
9. **Fine-grained revalidation tags.** Rejected for v1. School sites are small; whole-tenant invalidation is always correct, and the renderer already tags every read with `tenant:<id>`.
10. **Keeping the hand-written renderer types.** Rejected. ADR-0005/0017: once the contract is generated, a second source drifts. The renderer moves to the generated types. The dashboard's `Tenant`/`TenantBranding` in `packages/types` stays unchanged, since it is a different (authenticated) shape that the dashboard and e2e mocks consume.
11. **RJSF or JSON Forms for the schema-driven forms.** Rejected. Both bring their own widget and validation stack outside our `packages/ui` design system and react-hook-form + zod, and both support far more of JSON Schema than the constrained subset decision 6 allows. A ~300-line `SchemaFields` over that subset stays on-system and testable.
12. **Seeding themes by data migration.** Rejected. Every theme edit would need a migration, which contradicts spec §5.10. The `post_migrate` sync reuses the feature-flag pattern.

## Deferred (written to `docs/deferred-work.md` in the PR that skips each)

- Admission form endpoint → admissions module.
- Publish scheduling, slug-rename redirects, CAPTCHA, RSS, analytics embed (§19 recommendations). `analytics_id` is stored but not emitted.
- AI-WEB-01/02/03: the AI gateway is still in review (#182).
- Page duplication and a submit-for-review queue. Drafts wait for a publisher; the content inventory shows them.
- Multi-locale content. The `locale` column ships; v1 is single-locale.
- Outbound `website.*` webhooks: no webhook system exists.
- Contact CSV export and the traffic summary report.
- A real TLS edge provider, and plan-gating of custom domains (waits on platform-admin's plan resolver).
- Communication notice attachments on the site. Teacher subjects.
- Consent text on public forms (§6), as a tenant-configurable string. A retention purge of `contact_submissions.ip`: until it ships, the staff API never serialises `ip`.
- Renderer i18n. `apps/website` has no i18n today. New visible strings live in one `src/themes/default/copy.ts` constant map (English), so a later i18n pass has a single source.
- Batching contact-notification email: one email per submission in v1.

## Global Constraints

- **Branching.** Step 0 for each PR is to branch from `origin/main` after its predecessor merges. If the predecessor hasn't merged, stack on it and confirm `gh pr view <child> --json baseRefName` reads `main` before the child merges. Never `--delete-branch` under a stacked child.
- **Process.** No local test, lint, typecheck or `manage.py` runs; CI is the verifier. `main` moves only through a reviewed, CI-green PR, and the **human** merges it. Never commit or push without the user's go-ahead.
- **Commits.** No `Co-Authored-By` and no AI attribution. Never `--no-verify`. Conventional Commit subjects. Never touch `.env*`: new settings get a default in `config/settings/base.py` and a line in `apps/api/.env.example`. Compose wiring goes in `infra/compose/docker-compose.yml`.
- **Data model.** Every tenant table inherits `TenantOwnedModel` and gets `rls_operations(...)`. Never `Model.objects.all()` on tenant data.
- **Endpoints and contract.** Every endpoint declares its permission key or keys and a resolving `scope_campus_field` (`None`). Every write action is in `required_permission_map`. Cross-tenant access gives 404, never 403, with one cross-tenant test per CMS endpoint and one wrong-host test per public endpoint. Each new status/enum gets a `SPECTACULAR_SETTINGS["ENUM_NAME_OVERRIDES"]` entry. OpenAPI and `schema.d.ts` change in the same commit as the serializer that moved them.
- **Regenerate in the same commit.** Every task that touches a serializer, route or enum regenerates OpenAPI and the client in that same commit, and sweeps the dashboard, e2e and renderer fixtures of every changed type (L2, L41). Each task's "Commit" step below implies this.
- **List endpoints.** Every list endpoint declares explicit `ordering_fields` (L28) with a total order ending in `id` (L46). Enum labels in the dashboard go through the shared `enumLabel` helpers (L32).
- **Imports.** `core/` never imports `apps.website_cms` (ADR-0013). Other apps' data is read only through their `public.py` and changed only through their services.
- **Frontend and colours.** Dashboard wire types come from `ApiSchemas` (ADR-0017). Colours are theme tokens only, never arbitrary-value literals (root CLAUDE.md). No hardcoded English: every string goes through next-intl, in `en` and `ur`.
- **Gates and docs.** The coverage floor is 85% and only ratchets. The doc-sync gate means every PR touches `docs/project-status.md`. New words go in `.cspell/project-words.txt`; docs are `en-GB`.

## Review Focus

1. **Draft or private data leaking through a public endpoint.** Covered by:
   - draft, archived or hidden sections;
   - `show_on_website=false` records;
   - expired or other-page preview tokens;
   - a private file id asked of `/public/files`;
   - **a file whose last published reference was unpublished or replaced**;
   - **a JWT used on `/public/*`, or the machine token on CMS routes**.

   Tests: A2, A3, C1, C2, C3, C4, B1, B3.
2. **A host resolving to the wrong tenant or no tenant.** Covered by:
   - a pending, failed or disabled custom domain;
   - a reserved or multi-label subdomain;
   - a mixed-case host or one with a port;
   - a contact POST whose `X-Tenant-Slug` disagrees with `Origin`.

   Tests: C1, C5, D2.
3. **The site's own state.** A suspended, deprovisioned or provisioning tenant, `module.website` off, an unpublished site and maintenance mode all give 404 on content and the right `website_status`/`status` on `by-host`. Tests: C1, C2.
4. **Ordering and referential edits.** Covered by:
   - reordering sections or gallery items with colliding positions;
   - deleting a page that is the homepage or a navigation target;
   - unpublishing a navigation target.

   Tests: A3, A4, B2.
5. **Content referencing another tenant's file or a non-ready file, or carrying a `javascript:`, `data:` or `//` link.** It is rejected at save with 422 and never emitted. Tests: A2, A4, B1.

---

## PR A: `feat/website-cms-foundation` (backend)

Ships the app skeleton, themes, site settings, pages with sections, navigation, SEO and the validation core.

### Task A1: App skeleton, registries, themes

**Files:**
- Create in `apps/api/apps/website_cms/`: `__init__.py`, `apps.py` (`post_migrate` theme sync), `models.py`, `constants.py`, `features.py`, `permissions.py`, `uploads.py`, `views.py`, `urls.py`, `themes/__init__.py` (the code registry plus `sync_themes()`), `themes/default.json`, `schemas/rich_text.json`, `migrations/0001_initial.py`, `0002_rls_policies.py`, `tests/base.py`, `tests/factories.py`, `tests/test_cross_tenant.py`.
- Modify: `config/settings/base.py` (`MODULE_APPS`, `ENUM_NAME_OVERRIDES`), `config/api_v1.py`, `apps/api/pyproject.toml` (move `jsonschema` to runtime, `uv lock`).

**Interfaces:**
- **Produces:**
  - `FEATURE = "module.website"`;
  - the upload purpose `website.media` (images only, `image/jpeg|png|webp|gif`, 10 MB, `module_gated=True`);
  - models `Theme` (platform scope, `TimestampedModel`), `WebsiteSettings`, `WebsitePage`, `PageSection`, `NavigationMenu`, `SeoSetting`, with the columns from the entity doc;
  - enums `PageType`, `ContentStatus` (`draft`, `published`, `archived`), `MenuLocation`, `SeoTargetType`.

- [ ] Write `tests/test_registry.py`:
  - `test_every_section4_key_is_registered`: every §4 key, with `website.public-content.view` absent from the role registry (decision 1);
  - `test_default_theme_synced`: after migrate, `Theme.objects.get(code="default").section_types` keys equal the 14 types from decision 6;
  - `test_theme_sync_updates_changed_schema_without_migration`;
  - `test_theme_schemas_use_only_the_supported_subset`: walks every schema and allows only decision 6's keywords and `x-widget` values;
  - `test_section_type_enum_matches_theme`: the serializer's `section_type` choices equal the theme keys. Renderer drift is caught by `tsc` (decision 6).
- [ ] Implement the models, migrations (RLS on every tenant table; partial unique indexes per decision 14) and registries. Role tuples come from §4.
- [ ] Commit `feat(website-cms): app skeleton, themes and registries`.

### Task A2: Validation core

**Files:** `website_cms/validation.py`, `website_cms/media.py`, `tests/test_validation.py`.

**Interfaces:**
- **Produces:**
  - `validate_section_content(theme: Theme, section_type: str, content: dict) -> None`: raises `DomainRuleViolation` with field-keyed details for an unknown type or a schema error, the path in `details[].field`;
  - `validate_rich_text(doc: dict) -> None`;
  - `referenced_file_ids(schema: dict, content: dict) -> set[UUID]`: every value at an `x-widget: image` property, recursing into arrays and the rich-text `$ref`;
  - `assert_files_usable(ids) -> None`: each id must be a ready `website.media` file visible under the current tenant's RLS, or 422 `file_not_available`;
  - `is_safe_url(value: str) -> bool` (decision 5a), registered on a `FormatChecker` as `safe-url` and reused by every serializer link field;
  - `sync_file_visibility(file_ids: Iterable[UUID]) -> None` (decision 4): it asks a registry of reference providers (`register_public_reference_provider(fn)`; website content registers its own, and staff registers in B3) whether each id is still referenced by published content;
  - `to_public(schema, content, tenant_id) -> dict`: rewrites each image property `x` (or `x_file_id`) as `x_url`, the redirect URL built from `API_PUBLIC_URL`.

- [ ] Tests:
  - `test_unknown_section_type_rejected`;
  - `test_schema_error_reports_json_path`;
  - `test_rich_text_rejects_html_block_type`;
  - `test_heading_level_outside_2_to_4_rejected`;
  - `test_other_tenant_file_id_rejected` (Review Focus 5);
  - `test_pending_file_rejected`;
  - `test_rich_text_image_block_file_id_is_referenced`;
  - `test_safe_url_rejects_javascript_data_and_protocol_relative` (parametrised: `javascript:alert(1)`, `data:text/html,x`, `//evil.test`, `http://x`) and `test_safe_url_accepts_https_and_relative`;
  - `test_validator_enforces_format_checker` (a schema with `format: safe-url` rejects `javascript:`);
  - `test_to_public_rewrites_nested_file_ids`;
  - `test_sync_visibility_reverts_when_last_reference_unpublished`;
  - `test_sync_visibility_keeps_public_while_another_published_row_references`.
- [ ] Implement with `jsonschema.Draft202012Validator(schema, format_checker=checker)`, resolving `$ref` to `rich_text.json` through a `referencing.Registry` (Context7). Add `core.files.services.set_visibility(file, visibility) -> None` with its own test in `core/files/tests`.
- [ ] Commit.

### Task A3: Website settings, pages, sections, publish

**Files:** resource packages `settings/` and `pages/` (serializers, viewset, urls, services, filters, `tests/test_endpoints.py`), `website_cms/revalidation.py`, `website_cms/tasks.py`, `website_cms/urls_builder.py` (`tenant_site_url`, decision 9).

**Endpoints:**
- `GET/PATCH /website-settings`;
- `GET /themes`;
- `GET/POST /website-pages` (filters: `status`, `page_type`, `search`; page-number pagination);
- `GET/PATCH/DELETE /website-pages/{id}`;
- `POST /website-pages/{id}:publish`, `:unpublish`, `:archive`, `:preview`;
- `PATCH /website-pages/{id}/page-sections`.

**Interfaces:**
- **Produces:**
  - `ensure_default_site(tenant) -> WebsiteSettings` (decision 10);
  - `publish_page(page, user)`, `unpublish_page(page, user)`, `archive_page(page, user)`;
  - `replace_sections(page, sections: list[dict], user) -> list[PageSection]`;
  - `queue_revalidation(tenant_id: UUID, extra_tags: Iterable[str] = ()) -> None`;
  - the task `website_cms.revalidate_website(tenant_id, tags)`;
  - `make_preview_token(page) -> str`;
  - `read_preview_token(token) -> tuple[UUID, UUID]`, which raises `BadSignature` or `SignatureExpired`.

**Rules (§11):**
- `replace_sections` validates every section against the active theme and the referenced files. It writes positions in two passes, first `position + 10_000` and then `0..n-1`, so `unique(website_page_id, position)` never collides.
- Publish refuses zero visible sections with 422 `no_visible_sections`, sets `published_at`, audits, and queues revalidation.
- Publish, unpublish, archive, delete and `replace_sections` on a published page each call `sync_file_visibility` on the union of old and new references.
- The singleton views (`/website-settings`, `/navigation-menus`, `/seo-settings`) are `APIView`s, so each declares `authentication_classes` explicitly as JWT only (L63).
- There is only one `home` page. `PATCH website-settings.homepage_page_id` must point at the `home` page.
- `DELETE` of a published page gives 422 `unpublish_first`. `DELETE` of the homepage or of a navigation target gives 422 `page_in_use`.
- `PATCH website-settings` validates `theme_config` against `config_schema`, and `theme_id` against active themes. Toggling `is_published` or `maintenance_mode` queues revalidation.

- [ ] Tests:
  - `test_get_settings_without_row_returns_unsaved_default_and_writes_nothing`;
  - `test_ensure_default_site_is_idempotent_under_concurrent_calls` (two threads with `TransactionTestCase`; one set of rows);
  - `test_preview_url_uses_tenant_host` (subdomain, then the primary active domain once D lands);
  - `test_unpublish_reverts_file_visibility`;
  - `test_publish_without_visible_sections_422`;
  - `test_publish_queues_revalidation_on_commit` (with `captureOnCommitCallbacks`);
  - `test_reorder_swaps_positions` (Review Focus 4);
  - `test_replace_sections_drops_removed_sections`;
  - `test_delete_published_page_422`;
  - `test_delete_homepage_422`;
  - `test_reserved_slug_rejected` (parametrised over `RESERVED_PAGE_SLUGS`);
  - `test_slug_unique_per_locale_including_null`;
  - `test_preview_token_round_trip_and_expiry`;
  - `test_revalidation_task_signs_body_with_hmac` (asserting the header equals `hmac.new(secret, body, sha256).hexdigest()`);
  - `test_revalidation_noop_without_url`;
  - a permission test per write action (`self.allow(...)`);
  - cross-tenant 404s in `tests/test_cross_tenant.py`.
- [ ] Implement. New settings are `WEBSITE_REVALIDATE_URL=""` and `WEBSITE_REVALIDATE_SECRET=""`, each with an `.env.example` line. Reuse the existing `API_PUBLIC_URL` and `PLATFORM_DOMAIN`; add no new origin settings (ADR-0014).
- [ ] Commit.

### Task A4: Navigation and SEO

**Files:** `navigation/`, `seo/` packages and their tests.

**Endpoints:**
- `GET /navigation-menus`: all three locations, created empty on first read;
- `PATCH /navigation-menus/{location}`, with the `website.navigation.update` key;
- `GET /seo-settings?target_type=&target_id=`: returns the row, or an unsaved default;
- `PATCH /seo-settings?target_type=&target_id=`: upsert, with the `website.seo.update` key.

**Rules:**
- Menu items follow the entity schema, with depth ≤ 2 and ≤ 50 items.
- A `page` target must be a published page of this tenant, or 422 `invalid_target`.
- A `url` target must pass `is_safe_url`; so must `social_links[].url` and the links in `header_config`/`footer_config` (validated against `config_schema`) and `canonical_url`.
- The SEO target must exist for its `target_type`. `site` takes no `target_id`.
- `og_image_file_id` goes through `assert_files_usable`.

- [ ] Tests:
  - `test_menu_rejects_unpublished_page_target`;
  - `test_menu_rejects_javascript_url`;
  - `test_menu_depth_limit`;
  - `test_unpublishing_a_nav_target_keeps_menu_but_public_drops_it` (the public half is asserted in C2);
  - `test_seo_upsert_idempotent`;
  - `test_seo_unknown_target_422`;
  - cross-tenant entries.
- [ ] Implement, then regenerate OpenAPI and the client.
- [ ] Commit.

### Task A5: Docs and PR A

- [ ] Update:
  - `docs/03-modules/website-cms.md`: §4 read-key note, §12 template codes, §16 CMS endpoints as built, and a new §20 "Implementation notes";
  - the entity doc: partial uniques and `nulls_distinct`;
  - `docs/project-status.md`: Tier 5 row and matrix;
  - `deferred-work.md`;
  - ADR-0038, *Public website content: block rich text, schema-validated sections, `safe-url` links*.
- [ ] Copy this plan into `docs/superpowers/plans/2026-11-15-website-cms.md`.
- [ ] Run `change-reviewer` with this plan, fix, push, open the PR with an ELI5 section, `--assignee @me --label "needs review"`, and watch CI.

## PR B: `feat/website-cms-content` (backend)

### Task B1: News posts, school events, gallery

**Files:** the `news_posts/`, `school_events/` and `gallery/` packages, and migration `0004` with RLS for `news_posts`, `school_events`, `gallery_albums` and `gallery_items`.

**Endpoints:**
- `GET/POST /news-posts`, `GET/PATCH/DELETE /news-posts/{id}`, `:publish`, `:unpublish`, `:archive`;
- `GET/POST /school-events`, `GET/PATCH /school-events/{id}`, `:publish`, `:unpublish`, `:archive`. There is no DELETE: §4 has no key for it;
- `GET/POST /gallery-albums`, `GET/PATCH/DELETE /gallery-albums/{id}`, `:publish`, `:unpublish`;
- `GET/POST /gallery-albums/{id}/gallery-items`, `PATCH/DELETE /gallery-albums/{id}/gallery-items/{item_id}`, and `PATCH /gallery-albums/{id}/gallery-items:reorder` (body `{ids:[...]}`, the same two-pass position write).

**Rules:**
- Lifecycle transitions map to the `.publish` keys.
- `ends_at >= starts_at`.
- `image` items require `file_id`. `video_embed` items require an `embed_url` whose host is in `EMBED_HOSTS = {"www.youtube.com","youtube.com","youtu.be","player.vimeo.com","vimeo.com"}` (`constants.py`).
- An album's `school_event_id` must be the same tenant's event.
- An album must have at least one item to publish.
- Every lifecycle change, delete, item delete and content edit of a published row calls `sync_file_visibility`; every publish also queues revalidation and audits.

- [ ] Tests, per resource:
  - the lifecycle;
  - `test_event_end_before_start_422`;
  - `test_video_embed_host_not_whitelisted_422`;
  - `test_image_item_requires_file`;
  - `test_reorder_items` (Review Focus 4);
  - `test_publish_empty_album_422`;
  - `test_news_body_must_be_rich_text`;
  - `test_deleting_gallery_item_reverts_its_file_visibility`;
  - `test_replacing_news_cover_reverts_old_file`;
  - permissions;
  - cross-tenant 404s.
- [ ] Implement, then regenerate the contract.
- [ ] Commit.

### Task B2: Contact submissions (CMS side) and notification

**Files:** the `contact_submissions/` package and `website_cms/notifications.py`.

**Endpoints:**
- `GET /contact-submissions` (filters: `status`, `created_at__gte`, `created_at__lte`, `search`);
- `GET /contact-submissions/{id}`;
- `PATCH /contact-submissions/{id}`: only `status`; it sets `handled_by=request.user`.

**Notifications registered:**
- `website.contact-received` (in-app and email; to `reception` and `school_admin`);
- `website.domain-active` (in-app and email; to `it_admin`);
- `website.domain-failed` (email; to `it_admin`).

`create_contact_submission(tenant, data, ip, source_page) -> ContactSubmission` is called by C5.

- [ ] Tests:
  - `test_patch_sets_handled_by`;
  - `test_only_status_writable`;
  - `test_create_notifies_reception_and_admin`;
  - `test_ip_never_serialised_to_staff_api` (privacy);
  - cross-tenant.
- [ ] Implement.
- [ ] Commit.

### Task B3: Opt-in flags and the other modules' `public.py`

**Files:**
- `apps/staff_management/models.py` with its migration, serializers and `public.py`, plus tests;
- the same for `apps/school_organization/` (`Department`, `Class`);
- `apps/communication/public.py` with its test.

**Interfaces** (all called inside a bound tenant):
- **Produces:**
  - `public_teachers(limit:int) -> list[PublicTeacherRow]`, a frozen dataclass of id, full_name, designation, `photo_file_id`, bio;
  - `public_departments() -> list[PublicDepartmentRow]`;
  - `public_classes() -> list[PublicClassRow]`;
  - `primary_campus_contact() -> PublicContactRow | None`;
  - `public_notices(limit) -> list[PublicNoticeRow]`, merging published announcements and notices that are flagged `show_on_website`, unexpired, newest first, with body as plain text.

**Rules:**
- Only `is_active` (and, for staff, employed) rows with `show_on_website=true`.
- Staff registers a public-reference provider: a photo is referenced while its staff row is opted in and employed. Staff services call `sync_file_visibility` on a flag toggle, a photo change, exit, and `DELETE`.

- [ ] Tests:
  - `test_public_teachers_excludes_unflagged_and_inactive` (Review Focus 1);
  - `test_flag_toggle_sets_photo_visibility`;
  - `test_staff_exit_and_delete_revert_photo_visibility`;
  - `test_public_notices_excludes_expired_and_unflagged`;
  - `test_public_queries_are_constant` (`assertNumQueries`).
- [ ] Update `docs/05-database/entities/people.md` and `academics.md` with the new columns.
- [ ] Commit.

### Task B4: Docs and PR B

Same as A5: module doc §16/§20, project-status, deferred-work. Then review and open the PR.

## PR C: `feat/website-cms-public-api` (backend)

### Task C1: Machine auth and host resolution

**Files:**
- `core/rbac/machine.py` and `core/rbac/tests/test_machine.py`;
- `website_cms/hosts.py` and `tests/test_hosts.py`;
- `config/settings/base.py`: `MACHINE_CLIENTS`, `WEBSITE_MACHINE_TOKENS=""`, `WEBSITE_CNAME_TARGET=""`, `NUM_PROXIES` from env with default `None`, and a `machine_client` rate in `THROTTLE_RATES`;
- `tests/test_throttle_rates.py`;
- `apps/api/.env.example`;
- `infra/compose/docker-compose.yml`: map into the api and worker services `WEBSITE_MACHINE_TOKENS: ${PUBLIC_CONTENT_TOKEN}`, `WEBSITE_REVALIDATE_SECRET: ${REVALIDATE_SECRET}` (the same variable the website service uses) and `WEBSITE_REVALIDATE_URL: http://website:3000/api/revalidate`.

**Interfaces:**
- **Produces:**
  - `MachinePrincipal(client: str, scopes: frozenset[str])`, with `is_authenticated=True`, `pk=None` and no tenant;
  - `MachineTokenAuthentication`, which accepts any token in the client's list;
  - `HasMachineScope`, which reads `view.required_machine_scope`;
  - `MachineClientThrottle` (decision 2a);
  - `MACHINE_SCOPES`;
  - `client_ip(request) -> str | None`: honours `NUM_PROXIES`, shared by the throttles and the contact `ip`;
  - `resolve_host(host: str) -> Tenant | None`;
  - `website_status(tenant) -> Literal["live","maintenance","unpublished"]`.

**Also in C1:** the `CustomDomain` model (`TenantOwnedModel`, RLS) and the platform-scope `CustomDomainRoute` model, in migration `0005`. Resolution needs the route table now; the endpoints, adapters and lifecycle follow in PR D.

**Rules:**
- Lowercase the host, strip the port, IDNA-encode it, and reject it if empty.
- A platform host is exactly `<label>.<PLATFORM_DOMAIN>`, resolved by slug against non-deleted tenants.
- Anything else is looked up in `custom_domain_routes`.

- [ ] Tests:
  - `test_empty_token_setting_rejects_everything`;
  - `test_wrong_token_401`;
  - `test_scope_missing_403`;
  - `test_rotated_tokens_both_accepted`;
  - `test_machine_token_rejected_on_cms_routes` and `test_staff_jwt_rejected_on_public_routes` (Review Focus 1, L63);
  - `test_renderer_burst_of_reads_not_throttled` (100 reads on one host, under the `machine_client` rate);
  - `test_rotating_xff_does_not_reset_public_form_throttle` (with `NUM_PROXIES=1`);
  - `test_resolve_platform_subdomain`;
  - `test_resolve_rejects_multi_label_subdomain`;
  - `test_resolve_is_case_and_port_insensitive`;
  - `test_resolve_active_route_only` (pending/failed/disabled → None; Review Focus 2);
  - `test_deleted_tenant_unresolved`.
- [ ] Implement.
- [ ] Commit.

### Task C2: Public site, pages, sitemap and tenant reads

**Files:** the `public/` package (`views.py`, `serializers.py`, `urls.py`, `tests/`) and a new `PublicEndpointContractTests` in `apps/api/tests/test_endpoint_contracts.py`.

**Interfaces:**
- **Consumes:**
  - `resolve_host`, `website_status`, `to_public`, `read_preview_token` (A2/A3/C1);
  - the `public.py` functions (B3);
  - `operational_tenant`, `tenant_atomic`.
- **Produces:**
  - the base class `PublicContentView(APIView)`: `authentication_classes=[MachineTokenAuthentication]`, `permission_classes=[HasMachineScope]`, `throttle_classes=[MachineClientThrottle]`, `required_machine_scope="website.public-content.view"`. Preview arrives in the `X-Preview-Token` header, renderer to API, server to server, so no CORS change is needed. Its `get_tenant(request)` resolves `host`, checks operational state, `module.website` and `website_status == "live"` (all but `by-host`), raises `NotFound` otherwise, and binds `tenant_atomic`;
  - serializers `PublicTenant`, `PublicSite`, `PublicPage`, `PublicSection`, `PublicSitemapEntry` (they name the generated types).

- [ ] Tests:
  - `test_by_host_reports_suspended_status` and `test_by_host_404_for_deprovisioned_and_provisioning` (Review Focus 3);
  - `test_by_host_website_status_maintenance`;
  - `test_page_404_when_site_unpublished`;
  - `test_page_404_when_module_disabled`;
  - `test_homepage_for_empty_slug`;
  - `test_draft_page_404_without_preview`;
  - `test_hidden_sections_omitted`;
  - `test_preview_token_for_other_page_404`;
  - `test_expired_preview_token_404` (Review Focus 1);
  - `test_preview_token_in_query_string_ignored` (SEC-57: header only);
  - `test_site_navigation_drops_unpublished_targets`;
  - `test_sitemap_excludes_show_in_search_false`;
  - `test_wrong_host_never_returns_other_tenant_content`;
  - `test_every_public_route_declares_machine_scope_or_listed_anonymous` (the contract test, with an explicit allowlist of the two anonymous routes).
- [ ] Implement, then regenerate the contract.
- [ ] Commit.

### Task C3: Public content listings

News, events, gallery and the four other-module feeds, on `PublicContentView`. Each list is capped at 50 and returns a bare array.

- [ ] Tests:
  - `test_news_only_published_newest_first`;
  - `test_events_upcoming_default_and_past_scope`;
  - `test_event_detail_of_archived_404`;
  - `test_gallery_items_only_from_published_albums`;
  - `test_teachers_feed_uses_public_py_and_emits_photo_url`;
  - `test_list_queries_constant` (`assertNumQueries`).
- [ ] Implement.
- [ ] Commit.

### Task C4: Public file redirect

`GET /public/files/{tenant_id}/{file_id}`: `authentication_classes=[]`, `AllowAny`, and a new `PublicFileThrottle` (scope `public_file`, 120/min keyed per (`client_ip`, file_id); added to `THROTTLE_RATES` and `tests/test_throttle_rates.py`).

- [ ] Tests:
  - `test_public_ready_file_redirects`;
  - `test_one_ip_fetching_many_distinct_files_not_throttled` (the optimiser case);
  - `test_private_file_404`;
  - `test_file_404_after_last_reference_unpublished`;
  - `test_pending_file_404`;
  - `test_other_tenant_file_404`;
  - `test_suspended_tenant_404`;
  - `test_cache_control_header`.
- [ ] Implement.
- [ ] Commit.

### Task C5: Public contact POST and CORS

`POST /public/contact-submissions` runs `PublicFormThrottle` plus a new `PublicFormTenantThrottle` (scope `public_form_tenant`, 200/hour per tenant).

Flow:
1. Resolve the tenant from `X-Tenant-Slug`.
2. **When `Origin` is present**, require its host to `resolve_host` to the same tenant; otherwise 404 (Review Focus 2). A missing `Origin` (a future mobile client, Invariant 7) is allowed. The check is consistency, not authentication; the throttles and honeypot are the controls.
3. Require the tenant to be operational, the module on, and the site live.
4. Validate: `name` 1–150; `email` (`EmailField`) or `phone` (7–30 characters, digits/space/`+-()`) with at least one present; `subject` ≤ 200; `message` 1–5000; `source_page_id` optional, and if given a published page.
5. A non-empty honeypot `company_website` returns 201 and stores nothing.
6. `replay_or_execute` runs inside `tenant_atomic`, then `create_contact_submission`, with `ip=client_ip(request)`.

CORS:
- Add `x-tenant-slug` to `CORS_ALLOW_HEADERS`.
- Register a `corsheaders.signals.check_request_enabled` receiver in `WebsiteCmsConfig.ready()`. It returns True only for `/api/v1/public/` paths whose `Origin` host resolves to an operational tenant.

- [ ] Tests:
  - `test_contact_created_and_notified`;
  - `test_slug_origin_mismatch_404`;
  - `test_missing_origin_allowed`;
  - `test_honeypot_returns_201_and_stores_nothing`;
  - `test_email_or_phone_required`;
  - `test_message_length_cap`;
  - `test_idempotent_replay_returns_same_response`;
  - `test_ip_throttle_429`;
  - `test_cors_allows_tenant_origin_only`.
- [ ] Implement.
- [ ] Commit.

### Task C6: Docs and PR C

- [ ] Update:
  - the module doc §16, to the final public contract table;
  - `website-builder.md` §3/§6, for the host param, media redirect, revalidation body and paths;
  - `api-architecture.md` §2.2, for the machine clients setting;
  - `docs/06-security/security.md`, for the two anonymous public routes, the preview header and cookie, and `NUM_PROXIES`;
  - ADR-0039 (scope in the header note above, including decision 7);
  - ADR-0013's reference to the `public.py` read convention, and `repo-structure.md` §3;
  - project-status.
- [ ] Review, then open the PR.

## PR D: `feat/website-cms-custom-domains` (backend)

### Task D1: Domain endpoints, adapters, lifecycle

**Files:**
- the `custom_domains/` package (`services.py`, `adapters.py`, `viewset.py`, tests);
- `tasks.py`, for the beat entry `website_cms.reverify_custom_domains` every 15 min;
- `config/settings/base.py`: `WEBSITE_DNS_VERIFIER`, `WEBSITE_EDGE_PROVISIONER`, `CELERY_BEAT_SCHEDULE`;
- `pyproject.toml`: add `dnspython`.

**Endpoints:**
- `GET/POST /custom-domains`;
- `PATCH /custom-domains/{id}` (`is_primary` only);
- `POST /custom-domains/{id}:verify`;
- `DELETE /custom-domains/{id}`.

**Rules:**
- The domain must be a valid FQDN with at least 2 labels, ≤ 253 characters, IDNA-normalised, and not under `PLATFORM_DOMAIN`.
- A tenant may have at most `MAX_CUSTOM_DOMAINS = 5` live domains.
- **DNS never runs inside a transaction (ADR-0034).**
  - `:verify` is routed with `transaction.non_atomic_requests`, as the fees callback is. Mind L67 in its tests.
  - The beat uses `for_each_tenant(..., atomic=False)`, with a per-domain `tenant_atomic` only around the write.
  - Each write is a conditional `UPDATE … WHERE id=… AND status IN (<expected>) AND deleted_at IS NULL`. Zero rows updated means the user changed or deleted the domain mid-check, and the result is discarded (L49).
- `:verify` checks the TXT token and the CNAME, with a 3 s DNS timeout.
  - On success: `active`, `verified_at`, the route row inserted (an `IntegrityError` on the unique `domain` maps to 409 `domain_taken`, never check-then-write), `provisioner.request(domain)`, `website.domain-active` sent, and revalidation queued with every tenant host tag.
  - On failure: `failed`, with the reason in `last_error`.
- Route writes and deletes always filter by both `custom_domain_id` and `tenant_id`, because the table has no RLS.
- The beat task runs every 15 min. It re-verifies `pending_dns`, `verifying` and `failed` domains less than 72 h old, and sends `website.domain-failed` once when a domain is older than 24 h and `failure_notified_at` is null.
- **Active domains are re-verified daily.** After `ACTIVE_RECHECK_FAILURE_LIMIT = 3` consecutive failures (`consecutive_failures` column), a domain becomes `failed`, its route is dropped, and `website.domain-failed` is sent. This is the spec's "lapsed verification falls back" (website-builder §1).
- Only an `active` domain can be primary, and only one per tenant (partial unique index).
- `DELETE` removes the route in the same transaction, and the next primary falls back to the subdomain.
- **Dev only:** `WEBSITE_DNS_VERIFIER=fake` verifies any `*.test` domain and fails the rest, so the compose smoke test works across processes (L64).
- New columns `last_error varchar(300)`, `failure_notified_at` and `consecutive_failures smallint` are documented in the entity doc.

- [ ] Tests:
  - `test_create_returns_dns_instructions`;
  - `test_invalid_fqdn_422`;
  - `test_platform_subdomain_rejected`;
  - `test_verify_success_writes_route_and_notifies` (fake verifier);
  - `test_verify_failure_sets_failed`;
  - `test_second_tenant_cannot_activate_taken_domain_409`;
  - `test_primary_requires_active`;
  - `test_delete_removes_route`;
  - `test_tenant_deleting_pending_claim_of_other_tenants_active_domain_leaves_route` (Review Focus 2);
  - `test_concurrent_activation_second_gets_409_not_500`;
  - `test_beat_result_discarded_when_domain_deleted_mid_check`;
  - `test_active_domain_dropped_after_three_failed_rechecks`;
  - `test_verify_runs_outside_transaction`;
  - `test_beat_notifies_failure_once_after_24h`;
  - `test_limit_of_five`;
  - permissions;
  - cross-tenant.
- [ ] Implement, then regenerate the contract.
- [ ] Update `tenancy.md`, `platform-admin.md` (§6, §15, §18: ownership moved, with the reason) and `website-cms.md`.
- [ ] Commit.

### Task D2: Docs and PR D

Project-status and deferred-work (the TLS provider and plan gating). Then review and open the PR.

**Coordination note for the platform-admin session**, sent before PR A opens and recorded in deferred-work:
- `custom_domains` lives in `website_cms`;
- `provision_tenant` may call `ensure_default_site`;
- `lifecycle.transition` (suspend, reinstate, delete) should call `website_cms` revalidation for every host tag of the tenant, so `by-host` reflects suspension at once. Until then, the 300 s TTL bounds the staleness;
- the machine scope is outside the role registry, so its per-key `scope` work needn't consider it.

## PR E: `feat/website-renderer-live` (renderer + e2e)

### Task E1: Wire the renderer to the generated contract

**Files:**
- `apps/website/package.json` (add `@schoolhub/api-client`);
- `src/lib/content.ts`, `tenant.ts`, `api.ts`, `public-api.ts`, `render-page.tsx`, `robots.ts`, `sitemap.ts`, `proxy.ts`;
- `src/themes/default/sections/*`;
- `packages/types/src/website.ts`: delete the wire shapes. First grep every importer (L7): the renderer files listed in the dossier and any e2e mocks. Move each one to `ApiSchemas[...]` in this commit;
- `packages/types/src/tenant.ts` and its dashboard and e2e consumers (`apps/dashboard/src/services/modules/tenant/tenant-service.ts`, `e2e/src/mocks/domains/tenant.ts`, `e2e/src/data/factories.ts`): **unchanged**. The renderer stops importing `Tenant` and uses the generated `PublicTenant`, with `TenantBranding` kept as the token contract's input type;
- the theme registry `src/themes/default/index.ts`, typed `Record<ApiSchemas["SectionTypeEnum"], …>` (decision 6);
- `src/proxy.ts`: exempt `/api/revalidate` and `/api/preview` from the unknown-host rewrite;
- the root layout, for the custom-domain redirect;
- tests under `__tests__`.

**Changes:**
- Every read takes `host` and uses the final paths.
- `resolveTenant` maps the generated `status` and `website_status`: `suspended`, `maintenance` and `unpublished` render the neutral notice; `deprovisioned` and `provisioning` render unknown.
- The permanent redirect (308, as `permanentRedirect` answers; amended from "301" in PR E) to `tenant.custom_domain` for a platform-subdomain request (website-builder §4) happens **after the cached `resolveTenant()` in the layout**, through `permanentRedirect`. It does not happen in the proxy, which stays I/O-free (`host.ts:4-8`).
- The contact form posts to `/public/contact-submissions`, and the admissions form posts there too with `subject` (deferral above).
- `PublicClass.level` becomes a number. Drop `PublicDepartment.icon` and `PublicTeacher.subjects`.

- [ ] Tests (Jest):
  - `content.test.ts` asserting `host` on every read;
  - `tenant.test.ts` covering each status;
  - a layout test for the custom-domain redirect (308);
  - `proxy.test.ts`: `/api/revalidate` and `/api/preview` reach their routes on the apex and on `localhost`;
  - `public-api.test.ts` for the endpoint and headers.
- [ ] Commit.

### Task E2: New sections, detail pages, preview, revalidation tags

**Files:**
- `src/themes/default/sections/rich-text.tsx` and `faq.tsx`;
- a shared `src/themes/default/rich-text-blocks.tsx`, which renders blocks as React elements with no `dangerouslySetInnerHTML`;
- `apps/website/next.config.ts`:
  - **Image source.** `images.remotePatterns` is derived from `NEXT_PUBLIC_API_ORIGIN`, the **public** API origin the redirect URLs carry, not the internal `API_BASE_URL`.
  - **Local stacks** (amended in PR E). `WEBSITE_IMAGES_UNOPTIMIZED=true` sets `images.unoptimized`, so the browser loads image URLs itself; only compose and the E2E lanes set it, and `imagesConfig` refuses it with an https API origin. It replaced a `WEBSITE_IMAGES_ALLOW_LOCAL_IP` / `dangerouslyAllowLocalIP` flag: the optimiser never fetches from a local address.
  - **Lifetime.** `images.minimumCacheTTL` is 300 s, the API's public file cache, instead of Next's 4 h default.
  - **Redirects.** The redirect hop to the presigned storage URL stays within the default `maximumRedirects`.
  - Context7 (Next 16) confirms each setting before it is written;
- `src/themes/default/copy.ts`: the English constant map for new visible strings (see Deferred);
- routes `src/app/news/[slug]/page.tsx`, `src/app/events/[slug]/page.tsx`, `src/app/gallery/[slug]/page.tsx`, with JSON-LD `NewsArticle`/`Event` (website-builder §4);
- `src/app/api/preview/route.ts`, per decision 9 (amended in the PR E review: no Draft Mode):
  1. Validate the token by calling the API with `X-Preview-Token`.
  2. Only on a 200, set the httpOnly, Secure, `SameSite=Lax` 600 s token cookie. Never call `draftMode().enable()`.
  3. Redirect to the API-returned slug.

  While the cookie is held, `getPage` and `getSite` send its token as the header with `cache: "no-store"` and fall back to the cached published read on a 404 or 429; `/api/preview/exit` clears the cookie and `PreviewBanner` shows while it is held;
- `src/app/api/revalidate/route.ts`, which also accepts `tenant-host:*` tags in a signed body (a `tenant-hosts` tag was dropped in the PR E review: the API never sends it);
- the theme registry, which adds `rich_text` and `faq`.

- [ ] Tests:
  - `rich-text-blocks.test.tsx`: a heading/list/quote/image render, and an unknown block type renders nothing;
  - `faq.test.tsx`;
  - detail page tests (404 when the API returns null);
  - `preview.route.test.ts`:
    - no token → 400;
    - API 404 → 404, no draft cookie, no redirect;
    - API 200 → draft cookie set and a redirect to the **API's** slug, ignoring any `slug` query param (the open-redirect case);
  - `revalidate.route.test.ts`, adding the host-tag case.
- [ ] Commit.

### Task E3: Live lane, seed, docs, PR E

- [ ] Add `apps/website_cms/management/commands/seed_e2e_website.py`. It calls `ensure_default_site`, fills and publishes the home, about and contact pages, one news post, one event and one album, and enables `module.website`. Call it from `seed_e2e_data.py`, replacing the stale TODO at `:796`.
- [ ] Rewrite `e2e/tests/live/website-tenant-resolution.spec.ts` so a seeded host renders the published homepage, and add `e2e/tests/live/website-content.spec.ts`:
  - news detail renders;
  - a draft page gives 404;
  - a contact form submit shows success and the submission appears via the API;
  - the other tenant's host never shows this tenant's news.
- [ ] Update the live-lane env (`e2e/playwright.config.ts` `appEnv`, the `e2e-live` workflow):
  - give the API `WEBSITE_MACHINE_TOKENS` equal to the renderer's token;
  - set `NEXT_PUBLIC_API_ORIGIN` to the API's browser-reachable origin. It is inlined at build, so it must be set at build time; without it the contact form posts to the renderer and 404s;
  - set `WEBSITE_IMAGES_UNOPTIMIZED=true` (amended in PR E, see E2), `WEBSITE_REVALIDATE_URL` and the shared revalidate secret.

  Trace each live assertion through the real path before writing it (L17).
- [ ] Docs: `website-builder.md` §2.1 (section list) and §7, and project-status. Then review and open the PR.

### PR E amendments (declared divergences)

Recorded after the PR E change review; each was made on evidence during PR E:
- **Images.** `WEBSITE_IMAGES_UNOPTIMIZED` replaced `WEBSITE_IMAGES_ALLOW_LOCAL_IP` (E2): the optimiser never fetches from a local address, and compose and the E2E lanes let the browser load image URLs directly.
- **Theme limits.** `teachers_grid` and `gallery` `limit.maximum` went from 60 to 50, the API's list cap, so no saved value renders nothing.
- **Branding colours.** `packages/ui` accepts the API's functional colours (`rgb()`, `hsl()`, `oklch()`) in branding tokens, through one declared pattern.
- **Preview.** No Draft Mode (decision 9 as amended); `/api/preview/exit` and `PreviewBanner` were added; the API counts preview reads in their own per-host bucket.
- **`server-only`.** Added to the renderer so `lib/api.ts` and `lib/preview.ts` cannot be imported from a client component.
- **Seed.** `module.website` is enabled in `seed_e2e_data` (flags are core's), and `seed_e2e_website` also gives the other tenant a live home page for the cross-tenant probe.
- **Redirect.** 308, not 301 (E1).
- **Compose.** The worker has `extra_hosts: host.docker.internal:host-gateway` and `WEBSITE_REVALIDATE_URL` is overridable; the `website` service sets `WEBSITE_IMAGES_UNOPTIMIZED`; `seed-dev.sh` creates the bucket before the seeds.
- **Live specs.** Beyond E3's list: a published page on its own path, the album image through the file redirect, the contact message absent from the other school's inbox, and publish-time revalidation of the cached homepage.

## PR F: `feat/website-dashboard-pages` (dashboard)

### Task F1: Services, shell, shared editors

**Files:**
- `apps/dashboard/src/services/modules/website/<resource>/`: ADR-0019's five-file shape per domain (`*-constants.ts`, `*-schema.ts`, `*-service.ts`, …), with entries in `src/services/endpoints.ts`, `queryKeys` and `Paths`, registered in `Services`;
- `src/features/website/website-sections.ts` (decision 12a) and `src/config/menu-config.ts`: a "Website" group gated on `module.website`, whose items come from `sectionMenuItems(websiteSections)`;
- `src/app/(app)/website/layout.tsx` and the landing page `page.tsx` (content inventory: counts by status, and items not updated in more than 180 days flagged stale, §13);
- `src/features/website/shared/`:
  - `schema-fields.tsx` (decision 12);
  - `rich-text-blocks-field.tsx`;
  - `image-file-field.tsx` (the two-step upload with purpose `website.media`, reusing the existing files service);
  - `content-status-badge.tsx`;
  - `publish-actions.tsx`;
- `messages/en.json` and `ur.json`.

- [ ] Tests:
  - `schema-fields.test.tsx`: each widget renders, `required` errors show through a `FormMessage`, an unknown keyword is ignored;
  - `rich-text-blocks-field.test.tsx`: add, reorder and remove blocks;
  - `image-file-field.test.tsx`: an upload while saving is not dropped (dashboard-screen skill §5);
  - `menu-config.test.ts`: a `reception`-only user sees just the contact inbox, a `school_owner`-only user (custom-domain keys) sees domains, and a user with no website key sees no group.
- [ ] Commit.

### Task F2: Pages directory and page editor

**Files:**
- `src/features/website/pages/`: directory table, columns, filters, toolbar, create dialog, the `page-editor.tsx` screen, `section-list.tsx` (`@dnd-kit/sortable` with keyboard sensors, and move up/down buttons for accessibility), `add-section-menu.tsx` (from the theme's `section_types`), `section-editor.tsx` (schema-driven), and a preview button;
- `src/app/(app)/website/pages/page.tsx` and `[id]/page.tsx`.

The editor saves sections with a single `PATCH …/page-sections`. Server field errors are keyed by JSON path and mapped onto the section's fields.

- [ ] Tests:
  - directory: list state in the URL (ADR-0024), with filters;
  - editor: reorder sends the new order; publish is disabled with no visible sections; a 422 `page_in_use` on delete shows the translated message; the preview opens the returned URL;
  - a mocked Playwright spec `e2e/tests/dashboard/website-pages.spec.ts` with a mock domain `e2e/src/mocks/domains/website.ts` whose fixtures match the generated types (L41).
- [ ] Commit.

### Task F3: Docs and PR F

Project-status and the module doc §20 "Built (dashboard)". Then review and open the PR.

## PR G: `feat/website-dashboard-content` (dashboard)

### Task G1: News, events, gallery

Each is a directory with a create/edit dialog that uses the shared rich-text and image fields, plus publish/unpublish/archive actions and a detail sheet. Gallery adds an album detail with an item grid: multi-upload, dnd reorder through `:reorder`, captions and alt text. Routes go under `src/app/(app)/website/{news,events,gallery}`.

- [ ] Tests:
  - `event-form.test.tsx` (end before start blocked client-side and server error mapped);
  - `gallery-items.test.tsx` (reorder payload, a video embed host error);
  - `news-directory.test.tsx`;
  - a mocked e2e `website-content.spec.ts`.
- [ ] Commit.

### Task G2: Docs and PR G

## PR H: `feat/website-dashboard-site` (dashboard)

### Task H1: Settings, navigation, SEO

- **Site settings:** a theme picker, a `theme_config` form via `SchemaFields`, publish and maintenance switches with a confirm dialog, the homepage display, social links and the analytics id.
- **Navigation editor:** three location tabs and a tree with two levels, dnd and target pickers (a published page, URL, or index).
- **SEO:** a site form, and an "SEO" tab in the page, news, event and album editors, through a shared `seo-form.tsx`.

- [ ] Tests:
  - `navigation-editor.test.tsx` (depth limit, unpublished target error);
  - `site-settings.test.tsx` (the maintenance confirm);
  - `seo-form.test.tsx`.
- [ ] Commit.

### Task H2: Custom domains and contact inbox

- **Custom domains:** a list with status and TLS badges, an add dialog showing the TXT and CNAME instructions with copy buttons, verify, make primary, and delete with a confirm.
- **Contact inbox:** a directory filtered by status and date, a detail sheet, and mark read/responded/spam (the §13 contact report).

- [ ] Tests:
  - `custom-domains.test.tsx` (instructions render, a verify failure shows `last_error`, primary only on active);
  - `contact-inbox.test.tsx`;
  - a mocked e2e `website-site.spec.ts`.
- [ ] Commit.

### Task H3: Docs and PR H

The module doc §20, and project-status marking website-cms full-stack complete. Then review and open the PR.

---

## Verification

- **Per PR, all in CI:** the `api` workflow (`coverage run manage.py test` with the 85 % floor, ruff, `test_rls_coverage`, `test_endpoint_contracts` including the new public contract test, `test_import_boundaries`, `test_throttle_rates`, OpenAPI drift), `frontend` (Jest, tsc, eslint for the website and dashboard), `repo-hygiene` (links, cspell, plan-review block, doc-sync) and `infra-compose` for the compose edits.
- **After PR E:** dispatch `e2e-live` manually (`gh workflow run e2e-live.yml --ref <branch>`). The website specs must show the seeded homepage, a news detail and a contact submit, with a cross-tenant host showing nothing of the other school's.
- **Manual smoke** with the compose stack, done by the human:
  1. Publish a page in the dashboard.
  2. Within seconds, `http://<slug>.localhost:<port>/` shows it, through the revalidation webhook.
  3. Preview a draft.
  4. Bind `school.test` with `WEBSITE_DNS_VERIFIER=fake`; it verifies, because any `*.test` domain passes.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-11-15
- **Verdict:** REVISE. The architecture is sound, but preview, renderer throttling, media and `next/image`, URL-scheme validation, file-visibility reversal and dashboard role reachability needed concrete fixes before approval.
- **Findings addressed:** all 33, in this revision.
  - **1 reachability.** Decision 12a; F1 files and tests.
  - **2 machine throttle.** Decision 2a; C1 and C2.
  - **3 images.** Decision 4 keys the throttle per (IP, file); E2 `next.config` covers `remotePatterns` from the public origin, and local stacks load images unoptimised (amended in PR E from a local-IP flag).
  - **4 `safe-url`.** Decision 5a; A2 and A4 tests.
  - **5 visibility recompute.** Decision 4; A2, A3, B1, B3 and C4 tests.
  - **6 preview.** Decision 9, plus E2's validate-then-enable flow with the token in a header and cookie.
  - **7 proxy exemption.** Decision 8; E1.
  - **8 host tags.** Decision 8, plus the platform-admin coordination note in D2.
  - **9 redirect.** In the layout (E1).
  - **10 `NUM_PROXIES` and `client_ip`.** C1.
  - **11 settings.** `API_PUBLIC_URL` is reused; one revalidate secret, from `${REVALIDATE_SECRET}`.
  - **12 regeneration.** A Global Constraint covers every task.
  - **13 `NEXT_PUBLIC_API_ORIGIN`.** E3.
  - **14 DNS.** Non-atomic, with conditional writes (D1).
  - **15 active re-verification.** D1.
  - **16 drift.** The `SectionTypeEnum` OpenAPI enum, and a typed registry checked by `tsc`.
  - **17 theme sync.** Themes sync on `post_migrate`.
  - **18 `ensure_default_site`.** Idempotent, and GETs never write.
  - **19 auth-boundary tests.** C1; JWT-only singletons in A3.
  - **20 types.** The dashboard and e2e `Tenant` types stay unchanged; importers are grepped first.
  - **21 worktree.** Install inside it.
  - **22 route writes.** Tenant-keyed, with an `IntegrityError` mapped to 409, and tests.
  - **23 CI command.** Corrected.
  - **24 dashboard placement.** ADR-0019 placement and L28/L32/L46.
  - **25 ADRs.** 0038/0039 reserved.
  - **26 preview token.** Moved to a header, with a security.md update.
  - **27 rotation.** A token list.
  - **28 contact form.** `Origin` checked only when present; IP retention and consent text deferred.
  - **29 machine scope.** Kept out of the role registry.
  - **30 image references.** Derived from `x-widget: image`.
  - **31 renderer strings.** `copy.ts`, with i18n deferred.
  - **32 fake verifier.** Dev `*.test`.
  - **33 alternatives.** Alternatives 11 and 12 added.
- **Amended after the PR E change review (2026-11-16):** decision 9 drops Next's Draft Mode, because its `__prerender_bypass` cookie is build-wide and so can be replayed on any school's host to force uncached renders against that host's machine quota. The token cookie alone switches preview, only `pages` and `site` go uncached, and the API counts preview-header reads in their own per-(client, host) bucket (`public_preview`), replacing the content quota for those reads. The other PR E divergences are listed under "PR E amendments (declared divergences)".
- **Unresolved:**
  - **#10.** The production value of `NUM_PROXIES` depends on the deployment's proxy count. The default `None` keeps today's behaviour, and the value is set per environment when the deploy topology is fixed.
  - **#8 and #29.** Their coordination items are handed to the platform-admin session (D2 note).
