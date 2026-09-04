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
| 1 — People | [`student-management`](03-modules/student-management.md), [`staff-management`](03-modules/staff-management.md) | **Both full-stack complete** — `student-management` (PRs 1-4) and `staff-management` (this PR), see the per-module matrix below |
| 2–7 | attendance, academics, timetable, examinations, fees-finance, communication, parent-portal, website-cms, platform-admin, admissions, hr-leave, library, transport, inventory-assets, certificates-documents, reporting-analytics | Not started (fees-finance has a spec-only PR: voucher/receipt/birthday-card docs) |

## Per-module implementation matrix

| Module | API | Dashboard screens | E2E | Spec doc |
| ------ | --- | ------------------ | --- | -------- |
| school-organization | done | — (platform-admin/setup UI not built) | — | done |
| student-management | done (CRUD, guardians/documents/files, enrollment lifecycle/transfers, import/export/ID cards) | done (list/detail/create/edit + Guardians/Emergency contacts/Documents/History tabs, enroll/change-section/withdraw + transfer dialogs, import wizard, ID-card batch action) | — | done |
| staff-management | done (CRUD, designations, qualifications/documents with verification, invite/exit, import/export) | done (list/detail/create/edit + Qualifications/Documents tabs, import wizard) | — | done |
| fees-finance | — | — | — | partial (vouchers/receipts/birthday cards spec'd, no core module doc build-out) |
| everything else (14 modules) | — | — | — | done (spec exists; nothing implemented) |

---

## Done

The monorepo skeleton is in place and structurally complete.

| Area | State |
| ---- | ----- |
| Workspace root | pnpm workspace, Turborepo (`dev/build/lint/test/test:coverage/typecheck/clean`), `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`), `.npmrc`, `.nvmrc` (Node 24), `.env.example`, `.gitignore`, committed `pnpm-lock.yaml` |
| CI | `.github/workflows/frontend.yml` — install → API-schema-freshness check → lint → typecheck → test, then an isolated `Test (coverage)` job enforcing an **85% global `coverageThreshold`** per app (`pnpm test:coverage`, see [`07-quality/testing-strategy.md`](07-quality/testing-strategy.md) §9.6 — the floor is a ratchet, never decreases), a build matrix over `dashboard`/`website`, a Playwright E2E job, and a gitleaks secret scan. `.github/workflows/api.yml` — ruff, mypy, tests on real PostgreSQL 18 with coverage, OpenAPI staleness gate, `manage.py check --deploy`. `.github/workflows/repo-hygiene.yml` runs on every PR regardless of path (workflow-YAML validation, markdown-link check, cspell, Prettier, and the doc-sync gate below) |
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
- **No module screens beyond the dashboard home + student-management +
  staff-management.** Fees, attendance, academics, timetable, examinations,
  communication, parent-portal, … are untouched — the gap against
  [`01-phases/phase-2-core-build.md`](01-phases/phase-2-core-build.md) tier 2+.
- **No Tier 2+ backend module.** `apps/api/apps/` has `school_organization`,
  `student_management`, and `staff_management` only — Tier 1 ("People") is
  now complete.
- **`e2e`'s `live` project is opt-in only** — needs the real docker-compose
  stack, not part of the PR gate.
- **Feature-flag enforcement and per-tenant number counters now exist**
  (`core.tenancy.features`, `core.tenancy.sequences`, PR 1) — built as
  `student-management` foundation, reusable by every later module.
- **`core.files` now exists** (PR 2): the two-step presigned-upload flow
  (`POST /files` → `:confirm` → `:download`), backed by MinIO locally/in CI's
  `NullPresigner`, plus a direct `create_ready_file()`/`Presigner.put()` path
  (PR 4) for server-generated content (exports, ID-card PDFs) that has no
  client upload to wait for. **AV scanning is not implemented** —
  `FileStatus.QUARANTINED` is unreachable; a documented gap against
  `api-architecture.md` §11, not an oversight.
- `medical_notes` field-level restriction and the `filter_assigned_to_user`
  fail-closed default (no `staff` table to join against yet) both ship in
  PR 1, ahead of the features that will exercise them. The student<->guardian
  link has no destroy endpoint by design (see the module doc) — the
  dashboard has no "unlink" UI to match.
- **`core.idempotency` now exists** (PR 3): stores a colon-action's response
  per `(tenant, key, endpoint)` and replays it on a repeat `Idempotency-Key`
  within 24h. No cleanup job prunes expired rows yet — no Celery beat exists
  to run one.
- **Withdrawal is a single audited action**, not initiate/approve — no
  `student_withdrawals` entity exists. Clearance checks (fees/library/
  transport) always return "clear" since none of those modules exist yet.
  `student-transfers`' `:cancel` action and the `incoming` transfer type's
  execution workflow are both undefined — documented gaps, not oversights.
- **`core.jobs` and `core.tenancy.tasks.TenantAwareTask` now exist** (PR 4):
  `BackgroundJob` + `GET /api/v1/jobs/{id}` (restricted to jobs the caller
  themselves created), and the tenant-binding Celery base class every async
  task builds on. `POST /student-imports` (CSV/.xlsx, exact template headers
  — no column-mapping UI), `POST /student-exports` (not record-scope
  narrowed — export is admin-only in practice), and
  `POST /id-cards:generate` (QR code only, no barcode, no verification
  endpoint yet) are the three jobs built on it. WeasyPrint needs system
  libraries (`.github/workflows/api.yml`'s `test` job only — every
  WeasyPrint import elsewhere is lazy). A real bug was found and fixed along
  the way: `core.api.renderers.EnvelopeJSONRenderer` silently skipped the
  `{"data": ...}` wrap for any response serializing a field literally named
  `error` or `data` (matched on key presence, not the value's shape) —
  `BackgroundJob.error` tripped it on every successful `GET /jobs/{id}`.
- **`student-management` full-stack is now complete** (PRs 1-4) — this was
  the whole of Phase 2 Tier 1's first module.
- **`staff-management` full-stack is now complete** (this PR) — Tier 1's
  second and final module, closing out "People". `staff`, `designations`,
  `staff_qualifications`, `staff_documents` (module doc §15's owned entities);
  onboarding link (`:invite`), exit with clearance checks (`:exit`),
  qualification/document verification, bulk import/export. Deliberately
  deferred: **performance reviews** — `staff_performance_reviews` is a §19
  *recommendation*, absent from the locked entity map in
  `05-database/entities/people.md`; its four permission keys
  (`staff.performance-review.*`) are registered so the registry↔seeded-rows
  contract test stays pinned to the full module doc, but no model or endpoint
  ships. `TenantSettings` gained an `hr` JSON column (`employee_number_pattern`,
  `staff_document_types`) — a dedicated namespace next to `academic`/`branding`/
  `features`, since HR/leave and payroll (Tier 3/6) will need one too.
  **`:invite` creates the linked `User` row but sends no email** —
  `core.notifications` doesn't exist yet (communication is Tier 6); the
  account is created inactive with an unusable password, a documented gap in
  the same style as `core.files.File.av_scanned_at`.
  Two pre-existing gaps this module unblocks were also closed in the same PR:
  `Student.filter_assigned_to_user` now does the real
  `enrollments→section.class_teacher_staff_id→staff.user_id` join instead of
  `none()`, and `school_organization`'s three dangling `*_staff_id` columns
  (`campuses`/`departments.head_staff_id`, `sections.class_teacher_staff_id`,
  `houses.house_master_staff_id`) now validate tenant ownership via
  `staff_management.services.resolve_tenant_staff_id`, closing the same class
  of cross-tenant leak PR #25's review found in `student_management.user_id`.
  `core.rbac.permissions.DenyRestrictedPrincipals` (previously dead code, zero
  call sites) gets its first real use here on every staff endpoint.

---

## Start here next session

1. **CI is the source of truth for coverage** — the 85% `Test (coverage)` floor is a
   ratchet (never decreases), so a new PR without its own tests fails this check —
   expected, not a gate bug. Check the latest `frontend.yml` run for the current
   per-app percentages rather than trusting a number written here, since it drifts
   with every PR.
2. **Leave the two-TypeScript setup alone.** `typescript` is aliased to the TS 6 API for
   tooling and `@typescript/native` supplies TS 7's `tsc`. Collapse to one
   TypeScript only after typescript-eslint supports the 7.1 API (#10940).
3. **Do not bump ESLint to 10.** `eslint-plugin-react` (bundled in `eslint-config-next`)
   still calls `context.getFilename()`, which ESLint 10 removes.
4. **Decide the typed-routes question.** App code uses explicit prop types rather than Next 16's
   generated `PageProps`/`LayoutProps` globals. If the team prefers the generated
   globals, add `next typegen` to the `typecheck` script.
5. **`student-management` full-stack is complete**, landed as 4 sequenced,
   stacked PRs: PR 1 foundation + student CRUD, PR 2 guardians/documents/
   files, PR 3 enrollment lifecycle/transfers, PR 4 import/export + ID
   cards. Along the way it built genuinely reusable platform infrastructure
   every later module inherits: `core.tenancy.features` (feature flags),
   `core.tenancy.sequences` (gapless per-tenant counters),
   `core.tenancy.tasks.TenantAwareTask` (tenant-bound Celery base class),
   `core.files` (two-step upload + server-generated `create_ready_file()`),
   `core.idempotency` (`Idempotency-Key` replay), and `core.jobs`
   (`BackgroundJob` + `GET /jobs/{id}`).
6. **`staff-management` full-stack is complete** (one PR, not stacked —
   the module is small enough that the students-style multi-PR split wasn't
   needed), reusing every piece of infrastructure from item 5 as-is:
   `core.tenancy.features` (`module.staff` flag), `core.tenancy.sequences.
   allocate_number` (`employee_number`), `core.jobs`/`core.tenancy.tasks.
   TenantAwareTask`/`core.files.create_ready_file()` (import/export jobs).
   **Phase 2 Tier 1 ("People") is now done.**
7. **Tier 2 is next**: attendance, academics, and timetable (per
   `01-phases/phase-2-core-build.md`'s build order — all three depend on
   `staff-management` for teacher/section assignment, now unblocked). No
   scoping work has started on any of them yet.

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
