# Project Status — SchoolHub

Living hand-off note: what exists, what is deliberately missing, and where the next
session should start — across the backend, both frontends, and infra.
**Update this file in the same PR as the work it describes.**

Specification (source of truth): [`./`](./) — this directory
Read [`../AGENTS.md`](../AGENTS.md) first — especially the context-map rule.

---

## Where we are in the plan

[`01-phases/phase-plan.md`](01-phases/phase-plan.md) → we are in **Phase 2 (Core
Build)**, per [`01-phases/phase-2-core-build.md`](01-phases/phase-2-core-build.md).

| Tier | Modules | Status |
| ---- | ------- | ------ |
| 0 — Foundation | tenancy, auth/RBAC, [`school-organization`](03-modules/school-organization.md) | Done in substance — tenancy/RBAC/audit/API plumbing in `apps/api/core/`, `school_organization` Django app shipped and merged |
| 1 — People | [`student-management`](03-modules/student-management.md), [`staff-management`](03-modules/staff-management.md) | **In progress** — `student-management` full-stack underway (see the per-module matrix below); `staff-management` not started |
| 2–7 | attendance, academics, timetable, examinations, fees-finance, communication, parent-portal, website-cms, platform-admin, admissions, hr-leave, library, transport, inventory-assets, certificates-documents, reporting-analytics | Not started (fees-finance has a spec-only PR: voucher/receipt/birthday-card docs) |

## Per-module implementation matrix

| Module | API | Dashboard screens | E2E | Spec doc |
| ------ | --- | ------------------ | --- | -------- |
| school-organization | done | — (platform-admin/setup UI not built) | — | done |
| student-management | in progress | in progress | — | done |
| staff-management | — | — | — | done |
| fees-finance | — | — | — | partial (vouchers/receipts/birthday cards spec'd, no core module doc build-out) |
| everything else (15 modules) | — | — | — | done (spec exists; nothing implemented) |

---

## Done

The monorepo skeleton is in place and structurally complete.

| Area | State |
| ---- | ----- |
| Workspace root | pnpm workspace, Turborepo (`dev/build/lint/test/test:coverage/typecheck/clean`), `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`), `.npmrc`, `.nvmrc` (Node 24), `.env.example`, `.gitignore`, committed `pnpm-lock.yaml` |
| CI | `.github/workflows/frontend.yml` — install → API-schema-freshness check → lint → typecheck → test, then a build matrix over `dashboard`/`website`, a Playwright E2E job, and a gitleaks secret scan. `.github/workflows/api.yml` — ruff, mypy, tests on real PostgreSQL 18 with coverage, OpenAPI staleness gate, `manage.py check --deploy`. `.github/workflows/repo-hygiene.yml` runs on every PR regardless of path (workflow-YAML validation, markdown-link check, cspell, Prettier, and the doc-sync gate below) |
| `apps/api` | Django 6.1 + DRF 3.18, managed by `uv`. `core/tenancy` (Tenant/TenantSettings, RLS via `SET LOCAL` + `rls_operations`), `core/rbac` (User/Role/Permission, code-defined permission registry seeded via `post_migrate`), `core/audit` (append-only audit log), `core/api` (envelope renderer, pagination, exception handling, base viewsets). One Django app: `apps/school_organization` (campuses, departments, academic sessions, terms, classes, sections, subjects, houses) — the reference module every later app copies |
| `packages/types` | API envelope `{data, meta}` / `{error:{code,message,details,request_id}}`, cursor + offset pagination, job resource, auth/RBAC types (`PermissionKey = module.resource.action`), tenant + branding, website CMS content types |
| `packages/api-client` | Hand-written transport core: envelope unwrapping, bearer auth, single-flight refresh-on-401 + replay, `ApiError` normalization, cursor pagination helpers. The resource layer (`schema.d.ts`) is REGENERATED from `apps/api/openapi.yaml` and CI fails if it's stale |
| `packages/ui` | shadcn/ui (`new-york` style, Radix + lucide-react + sonner + tw-animate-css) in active use — button, card, data-table, tabs, sheet, label, tooltip, alert, avatar, dialog, badge, sidebar, table, separator, dropdown-menu, select, textarea, input, skeleton, form. `--sh-*` Tailwind v4 token layer; default platform brand is **Navy & Gold** |
| `packages/config` | Shared ESLint flat config (ESLint 9, typescript-eslint) |
| `apps/dashboard` | Auth-guard proxy, tenant-subdomain login (own subdomain namespace, auth cookies via a same-origin proxy), in-memory access token + refresh, TanStack Query client + key factory, `hasPermission`/`<Can>`, `(auth)/login` (RHF + Zod), `(app)` shell with permission-filtered nav + collapsible sidebar + tenant theming, dashboard page, `/api/health`, next-intl (`en` + `ur`, RTL) |
| `apps/website` | Host→tenant proxy, cached tenant resolution, read-only content layer, ISR rendering of `website_pages`/`page_sections`, theme registry + 12 section components, per-tenant sitemap/robots, HMAC-signed revalidate webhook |
| `e2e` | Playwright suite with `dashboard` and `website` projects run in the PR gate against mocked routes; a `live` project exists for the real compose stack but is not part of the PR gate |
| `infra` | Local dev stack (Docker: Postgres/Redis/MinIO/PgBouncer/Mailpit) |

Both apps (`dashboard`, `website`) were generated with `create-next-app` (Next 16,
Turbopack, Tailwind 4, `src/`, `@/*`) and then customized. The Next-managed block at
the top of each app's `AGENTS.md` is regenerated by `next dev` — removing it from a
diff only re-creates the uncommitted change, so commit it with your work instead.

### Doc-sync gate

`repo-hygiene.yml`'s `project-status-sync` job enforces this file's own rule: any
PR that touches `apps/**`, `packages/**`, or `e2e/**` must also touch this file,
or the check fails. Add `[skip-status-doc]` to the PR title for a change that
genuinely doesn't shift the status below (a dependency patch bump, a typo fix).

---

## Repository settings

- Merge commits **disabled** (squash/rebase only), head branches auto-deleted on merge.
- **Branch protection is NOT active yet.** Both the branch-protection and rulesets APIs are
  Pro-gated for private repos on this account (`403 Upgrade to GitHub Pro…`). The intended
  ruleset — PR required, the five CI checks required and strict, linear history, no force-push
  or deletion — is committed at [`.github/rulesets/main.json`](../.github/rulesets/main.json)
  and applies in one command once the plan allows. Until then, "green before merge" is
  discipline, not enforcement.

## Deliberately NOT done

- **No `node_modules` locally.** Nothing is installed, built, linted, or tested
  locally — CI is the source of truth.
- **No module screens beyond the dashboard home + student-management (in
  progress).** Fees, attendance, academics, timetable, examinations,
  communication, parent-portal, … are untouched — the gap against
  [`01-phases/phase-2-core-build.md`](01-phases/phase-2-core-build.md) tier 1+.
- **No `staff-management`, no other Tier 1+ backend module.** `apps/api/apps/`
  has `school_organization` only — `student-management`'s Django app is not yet
  scaffolded.
- **`e2e`'s `live` project is opt-in only** — needs the real docker-compose
  stack, not part of the PR gate.
- **No feature-flag enforcement, no per-tenant number counters, no background-job
  infrastructure, no two-step file upload** existed before `student-management`
  work started building them as foundation (Phase-2 DoD requires a server-checked
  flag per module, default off).

---

## Start here next session

1. **CI is fully green** — keep it that way; it is the source of truth for pass/fail.
2. **Leave the two-TypeScript setup alone.** `typescript` is aliased to the TS 6 API for
   tooling and `@typescript/native` supplies TS 7's `tsc`. Collapse to one
   TypeScript only after typescript-eslint supports the 7.1 API (#10940).
3. **Do not bump ESLint to 10.** `eslint-plugin-react` (bundled in `eslint-config-next`)
   still calls `context.getFilename()`, which ESLint 10 removes.
4. **Decide the typed-routes question.** App code uses explicit prop types rather than Next 16's
   generated `PageProps`/`LayoutProps` globals. If the team prefers the generated
   globals, add `next typegen` to the `typecheck` script.
5. **`student-management` is the active work.** See the per-module matrix above
   and the module doc's own progress; `staff-management` is next after it per
   the tier-1 build order.
6. Once `student-management`'s API exists, `staff-management` can start in
   parallel — it depends on `school-organization` only, not on `student-management`.

## Conventions worth re-reading before writing code

- Components resolve colour through `--sh-*` custom properties only — no literal hex, no
  `blue-600`. Tenant branding is the only thing that may override a `--sh-color-*`/
  `--sh-font-*`/`--sh-radius` value at runtime; the default is SchoolHub's own
  "Navy & Gold" platform brand — see the doc comment at the top of
  `packages/ui/src/styles/theme.css`. A `--sh-platform-*` tier is separate and
  never tenant-overridable at all.
- Permission-aware UI is UX, never enforcement — the API enforces.
- `apps/website` must never gain a write path.
- Every new env var goes into `.env.example` with a dummy value and a comment.
- Tenant isolation is enforced by PostgreSQL RLS; every tenant-owned table
  inherits `TenantOwnedModel` and gets a policy via `core.tenancy.rls.rls_operations`
  in a hand-written `0002_rls_policies.py`. Cross-tenant access returns 404, never 403.
- Every backend endpoint declares a `module.resource.action` permission key
  (`docs/02-architecture/auth-and-rbac.md` §2.1); the permission class fails closed.
- The API contract is generated, not hand-written — `apps/api/openapi.yaml` and
  `packages/api-client/src/schema.d.ts` change together, in one commit.
