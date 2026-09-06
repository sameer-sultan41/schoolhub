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
| 2 — Daily ops | [`academics`](03-modules/academics.md), [`timetable`](03-modules/timetable.md), [`attendance`](03-modules/attendance.md) | **In progress.** `academics` shipped; `timetable` shipped (this PR); `attendance` not started. Build order is `academics → timetable → attendance`, not the order the phase doc lists them: timetable needs academics' `teacher_subject_allocations` as its scheduling input, and attendance's period mode needs timetable |
| 3–7 | examinations, fees-finance, communication, parent-portal, website-cms, platform-admin, admissions, hr-leave, library, transport, inventory-assets, certificates-documents, reporting-analytics | Not started (fees-finance has a spec-only PR: voucher/receipt/birthday-card docs) |

## Per-module implementation matrix

| Module | API | Dashboard screens | E2E | Spec doc |
| ------ | --- | ------------------ | --- | -------- |
| school-organization | done | — (platform-admin/setup UI not built) | live-lane API journeys only (no dashboard UI to drive) — CRUD + tenant isolation for all 9 resources, plus the academic-session `:activate`/`:close`/`:clone` lifecycle | done |
| student-management | done (CRUD, guardians/documents/files, enrollment lifecycle/transfers, import/export/ID cards) | done (list/detail/create/edit + Guardians/Emergency contacts/Documents/History tabs, enroll/change-section/withdraw + transfer dialogs, import wizard, ID-card batch action) | — | done |
| staff-management | done (CRUD, designations, qualifications/documents with verification, invite/exit, import/export) | done (list/detail/create/edit + Qualifications/Documents tabs, import wizard) | — | done |
| academics | done (curriculum CRUD + `:clone`, teacher allocation + load summary, the promotion batch state machine with segregation of duties and idempotent execution) | — | live-lane API journeys + one promotion browser CUJ | done |
| timetable | done (rooms/periods CRUD, draft slot grid with `meta.conflicts` on every edit, `:validate` / `:publish` with supersede-by-end-dating, `GET /timetables/my` for teacher/student/guardian, substitutions + `:approve`/`:reject`) | done (week grid editor, conflict panel, publish action, My timetable, substitutions queue) | live-lane API journeys + one build-and-publish browser CUJ | done |
| fees-finance | — | — | — | partial (vouchers/receipts/birthday cards spec'd, no core module doc build-out) |
| everything else (13 modules) | — | — | — | done (spec exists; nothing implemented) |

---

## Done

The monorepo skeleton is in place and structurally complete.

| Area | State |
| ---- | ----- |
| Workspace root | pnpm workspace, Turborepo (`dev/build/lint/test/test:coverage/typecheck/clean`), `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`), `.npmrc`, `.nvmrc` (Node 24), `.env.example`, `.gitignore`, committed `pnpm-lock.yaml` |
| CI | `.github/workflows/frontend.yml` — install → API-schema-freshness check → lint → typecheck → test, then an isolated `Test (coverage)` job enforcing an **85% global `coverageThreshold`** per app (`pnpm test:coverage`, see [`07-quality/testing-strategy.md`](07-quality/testing-strategy.md) §9.6 — the floor is a ratchet, never decreases), a build matrix over `dashboard`/`website`, a Playwright E2E job, and a gitleaks secret scan. `.github/workflows/api.yml` — ruff, mypy, tests on real PostgreSQL 18 with coverage, OpenAPI staleness gate, `manage.py check --deploy`. `.github/workflows/repo-hygiene.yml` runs on every PR regardless of path (workflow-YAML validation, markdown-link check, cspell, Prettier, and the doc-sync gate below) |
| `apps/api` | Django 6.1 + DRF 3.18, managed by `uv`. `core/tenancy` (Tenant/TenantSettings, RLS via `SET LOCAL` + `rls_operations`), `core/rbac` (User/Role/Permission, code-defined permission registry seeded via `post_migrate`), `core/audit` (append-only audit log), `core/api` (envelope renderer, pagination, exception handling, base viewsets). One Django app: `apps/school_organization` (campuses, departments, academic sessions, terms, classes, sections, subjects, houses) — the reference module every later app copies |
| `packages/types` | API envelope `{data, meta}` / `{error:{code,message,details,request_id}}`, cursor + offset pagination, discriminated by `isCursorPagination()`/`isOffsetPagination()`. Fifteen bounded admin lists page by NUMBER (`PageNumberPagination` — students, staff, designations, campuses, departments, classes, sections, subjects, houses, rooms, periods, substitutions, class-subjects, allocations, promotions; the set is named in `api-architecture.md` §2.4), so their `total_count` is always present. Append-heavy lists keep cursors, where `total_count` stays opt-in and is omitted rather than nulled, job resource, auth/RBAC types (`PermissionKey = module.resource.action`), tenant + branding, website CMS content types |
| `packages/api-client` | Hand-written transport core: envelope unwrapping, bearer auth, single-flight refresh-on-401 + replay, `ApiError` normalization, cursor pagination helpers. The resource layer (`schema.d.ts`) is REGENERATED from `apps/api/openapi.yaml` and CI fails if it's stale |
| `packages/ui` | shadcn/ui (`new-york` style, Radix + lucide-react + sonner + tw-animate-css) in active use — button, card, data-table, tabs, sheet, label, tooltip, alert, avatar, dialog, badge, sidebar, table, separator, dropdown-menu, select, textarea, input, skeleton, form, and a `chart` port over Recharts whose `ChartConfig.color` is TYPED to `var(--sh-color-chart-N)` so a literal colour is a compile error rather than a review note. Plus `empty-state`, `stat-card` (with an `unavailable` state, so a metric whose module does not exist yet says so rather than rendering an error), and shape-matched `skeletons` (screen header / table / grid / chart / detail / form). `Card` takes `elevation` (flat/raised/floating) and `tone` (surface/spotlight). `DataTable` is now a table LAYER rather than a table: it draws one card holding a `toolbar` slot (the screen's filter row plus a show/hide-columns menu), the table itself, the empty state and a footer carrying rows-per-page, the `{from}–{to} of {count}` summary and a numbered pager — so `Table` grew a `frame` prop and the card owns the border. Columns declare `sortKey` (server-side ordering only — a header sorts exactly when the endpoint allows it), `numeric` (`measure` end-aligned, `identifier` start-aligned, both in the figures face), `alwaysVisible`, and a per-column `skeleton`. New primitives: `Checkbox` (Radix, with an indeterminate state), `Pagination` + `getPageNumbers`, `DataTableColumnsMenu`, a `soft` `Badge` appearance with `BadgeDot`. `--sh-*` Tailwind v4 token layer; default platform brand is **Ink & Brass**. The token layer now carries three surface planes (`surface-sunken`/`surface`/`surface-raised`), three brand-tinted elevation steps, an `info` hue, one named gradient (`bg-spotlight`), and a validated six-slot chart ramp — and the `dark` variant answers to both a `.dark` class (the dashboard's toggle) and `prefers-color-scheme` (the website, which has no toggle) |
| `packages/config` | Shared ESLint flat config (ESLint 9, typescript-eslint) |
| `apps/dashboard` | Auth-guard proxy, tenant-subdomain login (own subdomain namespace, auth cookies via a same-origin proxy), in-memory access token + refresh, TanStack Query client + key factory, `hasPermission`/`<Can>`, `(auth)/login` (RHF + Zod), `(app)` shell with a grouped, icon-bearing, permission-filtered nav (modules with no route render disabled with a "Soon" badge rather than as links that 404), breadcrumb, a ⌘K command palette (cmdk) that lists only what the viewer can actually reach, account menu with a locale switch, collapsible sidebar + tenant theming, a dashboard home built from endpoints that exist — a proportional bell-schedule band, teacher-load and class-capacity charts, pending-work queues, permission-filtered quick actions and real school-shape counts (`GET /reports/dashboard-summary` never existed and is gone), a `loading.tsx` per route with a skeleton shaped like that route's own content, one shared `ScreenHeader`/`ApiErrorAlert`/`FilterBar`/`PersonCell` in place of the copies each module kept, all eight list screens on one `useTableParams` hook that holds filters, search, sort, page, page size and hidden columns in the URL — so a filtered, sorted, paged view with a chosen column layout is a link a colleague can open, `/api/health`, next-intl (`en` + `ur`, RTL), a light/dark/match-system toggle (`next-themes`, `attribute="class"`) whose resolved theme the toaster follows, and `motion` behind `LazyMotion`+`m` with `MotionConfig reducedMotion="user"` |
| `apps/website` | Host→tenant proxy, cached tenant resolution, read-only content layer, ISR rendering of `website_pages`/`page_sections`, theme registry + 12 section components, per-tenant sitemap/robots, HMAC-signed revalidate webhook |
| `e2e` | Playwright suite with `dashboard` and `website` projects run in the PR gate against mocked routes. `live` (real compose stack, seeded by `manage.py seed_e2e_data`) is opt-in via `.github/workflows/e2e-live.yml` (`workflow_dispatch` + nightly, not the PR gate) — real-browser journeys for login/logout/session/dashboard-summary/tenant-resolution, plus API-only journeys for every `school_organization` resource (no dashboard UI exists for that module yet). `AuthEndpointThrottle` allows only 10 requests/minute, and refresh tokens rotate, so a shared browser session can safely serve at most one cold-navigation test — every live browser spec logs in for itself instead (`e2e/AGENTS.md` has the confirmed reasoning); the `live-setup` project stays wired up for a future spec that's actually safe to share, but nothing uses it today. Live API specs (`tests/live/api/`) share one real login per worker via a worker-scoped fixture instead, which has no rotation problem. `student-management`'s first two Critical User Journeys now have real coverage too: `students-admission-enrollment.spec.ts` (real browser, a minimally-privileged seeded `school_admin` identity — not the all-permissions `school_owner` — walks create student → link guardian → add emergency contact → enroll, plus the real duplicate-admission rejection) and `api/students-record-scope.spec.ts` (a seeded `student`-role identity, `RecordScope.OWN`, proves it sees only its own `Student` row and gets 404 — never 403 — on another's) |
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

- **RLS is now genuinely enforced in CI** — it was not before. `api.yml`
  connected as the postgres image's `POSTGRES_USER`, which is a **superuser**,
  and a superuser bypasses Row-Level Security even with `FORCE`. Every
  cross-tenant test in the suite was therefore passing on
  `TenantScopedManager` — the Python layer — alone, while
  [`07-quality/testing-strategy.md`](07-quality/testing-strategy.md) §1.4
  claimed the database mechanism was being exercised and `AGENTS.md`
  invariant 1 claimed the app role had neither `BYPASSRLS` nor table ownership.
  `tests/test_rls_coverage.py` did not catch it because it inspects the
  *catalogue* (policy present, RLS enabled, FORCEd) rather than enforcement for
  the connecting role. Tests now connect as a `NOSUPERUSER NOBYPASSRLS`
  `schoolhub_app`, and `tests/test_rls_enforcement.py` asserts the outcome
  through the unfiltered `all_tenants` manager, so only the database can be
  what returns zero rows. Two conditions from
  `infra/postgres/init/02-app-role.sql` are still unmet in CI, both accepted
  and both unrelated to the RLS-bypass invariant itself: (1) the role owns the
  tables it migrated, because Django's test runner creates and migrates over the
  same connection it tests on — which is exactly what `FORCE ROW LEVEL SECURITY`
  covers, and is itself asserted; (2) the role holds `CREATEDB` and `CREATE` on
  schema `public` so it can self-provision the ephemeral test database, whereas
  production's `schoolhub_app` is `NOCREATEDB` with `USAGE` only. A future
  regression that grants CREATE privileges to the production role would not be
  caught by this CI role, since it already has them unconditionally.
- **No `node_modules` locally.** Nothing is installed, built, linted, or tested
  locally — CI is the source of truth.
- **No module screens beyond the dashboard home + student-management +
  staff-management + timetable.** Fees, attendance, academics, examinations,
  communication, parent-portal, … are untouched — the gap against
  [`01-phases/phase-2-core-build.md`](01-phases/phase-2-core-build.md) tier 2+.
- **Tier 2 is two modules in.** `apps/api/apps/` now also has `academics` and
  `timetable`; `attendance` is the tier's remaining module.
- **`e2e`'s `live` project is opt-in only** — needs the real docker-compose
  stack, not part of the PR gate. Trigger it via `.github/workflows/e2e-live.yml`
  (`workflow_dispatch` or the nightly schedule).
- **No real tenant-CMS-content or dashboard-summary e2e coverage yet** — both
  depend on backend endpoints that don't exist (`/public/tenants/by-host`,
  `/reports/dashboard-summary`). The corresponding `live` specs pin today's
  real degraded behavior instead and say what to replace once each ships.
- **The School Settings 403 is fixed** (`2de5c3c`). It was real: `GET
  /api/v1/school-settings` 403'd for every request because `SchoolSettingsView`
  was a plain `APIView` rather than a `TenantScopedViewSetMixin`-based viewset,
  so it never got `request.tenant` and `RequiresModuleFeature`'s own
  `if tenant is None: return False` denied it before the flag was ever checked.
  Mixing in `TenantScopedViewSetMixin` — purely for its `initial()` tenant
  binding, which runs after DRF authentication and inside the request
  transaction, unlike `TenantMiddleware` — resolved it.
  `e2e/tests/live/api/school-settings.spec.ts` now asserts the working
  patch→read journey rather than pinning the bug.
- **`timetable`'s gaps are named, not hidden.** `POST
  /timetables/{section_id}:generate-draft` is **not built**: it is AI-TTB-01,
  Phase 3 work that has to go through the `core/ai` gateway (AGENTS.md hard
  rule 6), and that package does not exist — a 202 pointing at a job nothing
  runs would be worse than the omission. Also absent, each lacking a §16
  endpoint to hang it on: §13's five reports, §6's copy-from-previous-session
  and bulk-clear, AI-TTB-03 substitute ranking, and PDF/Excel/iCal export —
  `timetable.timetable.export` is registered as §4 declares it but no route
  exercises it, the same deliberate shape as `staff.performance-review.*`.
  Two of §12's five notification triggers are deferred to the communication
  module, which owns the recipient rules for resolving a whole section's
  families. `services._slot_weekday` is correct only while a tenant starts its
  week on Monday; the real conversion belongs with the tenant week-start
  setting, which does not exist yet.
- **A published timetable cell cannot be removed.** `:publish` now supersedes
  cell by cell — a live row is end-dated only where a draft exists to replace
  it. Before, it end-dated every live row in the section, and since the builder
  drafts one row per edited cell rather than a whole week, editing Monday's
  first period retired Tuesday through Friday and students opened a nearly empty
  timetable. §5.7 and §7.1 describe a whole-grid "version n+1" that would have
  made the old behavior correct, but nothing materialises that full draft grid,
  so the doc and the code disagreed and the code lost data. The cost of the fix
  is that **removal now has no way to be expressed**: it was only ever "the next
  version omits this cell", and publish is incremental, so an omission means
  "leave it alone". `DELETE /timetable-slots/{id}` refuses a published row (§5.7 — a live
  cell is edited by drafting over it), and §16 declares nothing else. Closing
  this needs a decision about what removing a live cell means — a tombstone
  draft, an explicit whole-grid publish mode, or a `:clear-cell` action — not a
  filter change. No deletion flow was invented in the meantime.
- **`SubstitutionStatus.completed` and `.cancelled` are reserved and
  unreachable.** Both are in the locked entity map's enum;
  `decide_substitution` only ever produces `confirmed` or `declined`, and §16
  declares no endpoint that reaches either. `completed` waits on the attendance
  module to signal that a covered period actually ran — nothing in `timetable`
  knows a period happened. `cancelled` waits on a `:cancel` action for the case
  §7.2's flowchart stops short of: the absent teacher returns and confirmed
  cover has to be released. That one has a real cost — a confirmed substitution
  holds `subs_substitute_one_per_period` for its (date, period), so the
  substitute cannot be assigned elsewhere and nothing can let them go — but
  building it means inventing an endpoint §16 does not list and a notification
  §12 does not list, so it waits on the module doc rather than being
  half-built. `models.py` carries the same note beside the enum.
- **`teacher_substitutions.room_id` was added to the locked entity map.**
  `timetable.md` §6 and §15 both promise "ad-hoc room change supported on the
  substitution" while `entities/academics.md`'s column list omitted the column.
  The column and its clash guard shipped and the entity doc now agrees — an
  override that could double-book a room would have been the one booking path
  nothing checked. **`period_id` joined it** for a different reason: §11's two
  occupancy rules are per period on a date, the service checked them with an
  unlocked `.exists()`, and a unique index cannot reach through
  `timetable_slot` to get the period — so the column carries a copy and
  `subs_substitute_one_per_period` / `subs_room_one_per_period` are what hold
  when two proposals race. The copy is safe because neither end moves: a
  substitution's slot is fixed at creation and a published slot is immutable in
  place. The other half of each rule — the substitute's own published class,
  a published slot already in the room — crosses tables and stays service-only.
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
  within 24h. Expired rows are pruned hourly by
  `core.idempotency.tasks.prune_idempotency_records` (PR 0).
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
- **`staff-management` full-stack is now complete** (PR #30) — Tier 1's
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
  **`:invite` now emits a `staff.invited` notification, in-app only** (PR 0):
  `core.notifications` exists, but the account is still created inactive with
  an unusable password because no set-password/SSO onboarding flow exists, so
  an *email* saying "your account is ready" would be untrue. The remaining gap
  is the onboarding flow, not the notification layer — adding
  `NotificationChannel.EMAIL` to the trigger is a one-line change once it
  lands. Documented in the same style as `core.files.File.av_scanned_at`.
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
- **The guardian record-scope gap is closed** (PR 0). `scope_queryset` used to
  filter `RecordScope.OWN` as `own_field == user.pk` and nothing else, so a
  guardian's portal account matched no student row at all — "a guardian can see
  only their own child's record" was not enforced, it simply returned nothing
  while looking like it worked. `own` now delegates to a `filter_owned_by_user`
  model hook the way `assigned` already delegates to `filter_assigned_to_user`;
  `Student`'s implementation unions the student's own row with the children
  they hold a live, portal-enabled `student_guardians` link to. Every Tier 2+
  module that grants a guardian an `own`-scoped view key depends on this, and
  parent-portal (Tier 4) is built entirely on it.
- **The api-client refresh conflation is fixed** (PR 0). Three layers collapsed
  "the refresh token is invalid" into the same result as "the refresh call
  failed for an unrelated reason": `token-store.ts`'s `refreshAccessToken()`
  (any non-2xx returned `null`), `client.ts`'s `refreshOnce()` (a bare `catch`
  swallowing every throw), and the dashboard's own `.catch(() => null)` in
  `refreshViaProxy` — so a `429` from `AuthEndpointThrottle`, a `5xx`, or an
  offline moment cleared a still-valid session and bounced the user to
  `/login`. The two outcomes are now distinct: `null` means the session is
  over, a thrown `ApiError` means the refresh could not be determined and the
  session survives. `ApiError.isTransient` names the distinction once, and
  `restoreSession`/`useSession` retry on it.
- **Staff file uploads were dead and are now fixed** (PR 0) — a bug nothing had
  flagged. `staff_management.services` called `assert_file_usable` with
  `staff.photo`, `staff.qualification` and `staff.document`, but
  `settings.FILE_UPLOAD_RULES` only ever listed the student/guardian purposes,
  so `POST /api/v1/files` answered 422 ("Unknown upload purpose") for every
  staff photo, qualification certificate and staff document since PR #30 — the
  dashboard tabs existed and could not upload anything. Fixed structurally
  rather than by lengthening the dict: upload purposes now live in a registry
  (`core/files/purposes.py`) that each module populates from its own
  `uploads.py`, exactly as it declares permission keys and feature flags, and
  services reference the registered spec's `key` instead of retyping the string.
  `settings.FILE_UPLOAD_RULES` is gone.
- **Celery beat now has a schedule** (PR 0). The `celery-beat` service has
  shipped in compose and Terraform since the infra PR but no
  `CELERY_BEAT_SCHEDULE` was ever declared, so it started up and ran nothing.
  Two prunes are wired (`core.idempotency`, `core.jobs`), both sweeping tenant
  by tenant via `core.tenancy.maintenance.for_each_tenant` — an unbound
  cross-tenant delete does not raise under RLS, it silently matches zero rows,
  which is why the sweep shape matters. A static dict, not `django-celery-beat`:
  reporting-analytics (Tier 7) is the module that genuinely needs tenant-editable
  schedules and should bring that dependency with it.
- **RLS is exercised in CI now** (found in PR 0, fixed in PR #34 — see
  "Deliberately NOT done" above for the full account). CI creates a
  `NOSUPERUSER NOCREATEROLE NOBYPASSRLS` `schoolhub_app` role and connects as
  it, and `apps/api/tests/test_rls_enforcement.py` asserts both that the
  connecting role cannot bypass and that the policy actually hides rows.
  **The parity is on RLS enforcement only, not on the role generally** — the
  workflow's own comment says so and this doc should too. CI's role still holds
  `CREATEDB`, and it owns the tables it creates, because one role both creates
  the test database and runs against it. Production splits that across
  `schoolhub_migrator` (owns everything) and `schoolhub_app` (owns nothing,
  `NOCREATEDB`, `USAGE` only on schema public). `FORCE ROW LEVEL SECURITY` is
  what makes the ownership difference stop mattering for isolation — an owner
  would otherwise bypass its own policies — which is why the enforcement claim
  holds while the general parity claim does not.
  `core/tenancy/tests/test_maintenance.py` asserts the unbound case through
  `all_tenants` — the assertion it had been carrying as a code comment because
  a superuser connection could not have demonstrated it.
- **Campus record scope was a 500 on every tenant-wide table.**
  `TenantScopedViewSetMixin` defaults `scope_campus_field` to `"campus_id"`, and
  seven viewsets serve tables that have no such column — `/classes`,
  `/subjects`, `/houses`, `/academic-sessions`, `/terms`, `/designations` and
  `/campuses` itself. `scope_queryset` filtered on the missing column and raised
  `FieldError`. Nothing caught it because it needs a campus-scoped caller *with*
  a campus reference, and every test in the suite used an `all`-scoped user,
  which returns before the campus branch is reached. `scope_campus_field = None`
  is now the explicit opt-out meaning "this table has no campus dimension", and
  such a scope passes through rather than narrowing to nothing — a campus admin
  who cannot see "Grade 6" cannot create a section in it. `/campuses` scopes on
  its own `id` instead. `tests/test_endpoint_contracts.py` walks the URL conf and
  fails on any viewset whose scope field does not resolve, so the next
  tenant-wide table is enrolled without anyone remembering to.
  **A second, quieter half followed**: `departments.campus_id` and
  `class_subjects.campus_id` are nullable and mean "every campus", and
  `IN (...)` drops NULL — so a campus-scoped principal lost exactly the shared
  rows that applied to them, with no error to report it.
  `scope_campus_allows_null` is the shared opt-in for both, and the tests assert
  the row is visible rather than that the query merely does not crash — the
  distinction the first round missed, since `.none()` is also a 200. Asking for
  it *and* a `filter_by_campus` hook now raises: the hook owns the whole campus
  predicate, so the widening would have been silently dropped, which is the same
  short-list-and-no-error failure again one level up.
  `periods` is the third table with this shape and is **not** converted here —
  it lives on the unmerged `feat/timetable` branch, where `PeriodViewSet` still
  carries a bespoke `get_queryset` union. Moving it onto the shared flag is that
  branch's job once this lands.
- **`core.notifications` now exists** (PR 0) — the machinery every module doc's
  §12 table needs: the `notifications`/`delivery_logs` tables, the
  `ChannelAdapter` interface with working in-app and email adapters, a
  code-declared trigger catalog and platform template registry, and `notify()`,
  which persists a row per recipient per channel *before* enqueuing. **Ownership
  decision:** `entities/communication.md` lists both tables under the
  communication module, but `notifications.md` §1/§10 puts the machinery in
  `core/notifications/`; core owns the tables and delivery, communication (Tier
  4) later adds announcements/notices/threads, tenant template overrides,
  preferences, the delivery dashboard and the SMS/push/WhatsApp adapters — which
  are registered here but raise, naming the module that will implement them.
  Deliberately absent, all communication scope: preferences, quiet hours,
  suppression lists, SMS quotas, provider status webhooks, the SSE badge stream,
  and §6's full five-stage retry schedule.

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
7. **PR 0 (platform hardening) is done** — three fixes and two new pieces of
   platform infrastructure, all listed above: the upload-purpose registry, the
   guardian record scope, the api-client refresh split, the Celery beat
   schedule, and `core.notifications`. Every Tier 2 module consumes at least
   two of them.
8. **Tier 2 is next, in this order: `academics` → `timetable` → `attendance`.**
   Not the order the tier table lists them in, and the difference is
   load-bearing: `timetable` needs `academics`' `teacher_subject_allocations`
   as its scheduling input, and `attendance`'s period-wise marking and
   absent-teacher substitution feed need `timetable`. Building attendance last
   means period mode ships natively instead of being retrofitted. One
   full-stack PR each, matching PR #30's shape rather than students' four-PR
   stack.
9. **The table layer is done; three things are deliberately left for a later pass.**
   Every list screen is `useTableParams` + `DataTable`, every column backed by a
   real field is sortable, and the endpoints were widened to match — including
   `StableOrderingFilter`, which appends a unique tiebreaker so a cursor page
   boundary can no longer land mid-tie and silently skip or repeat rows. Not
   done, and each its own piece of work:
   - **Row actions.** No table has a trailing `…` menu; rows navigate on click.
     The reference kits put edit/delete/duplicate there, which needs a per-screen
     action inventory and a permission key each.
   - **Responsive default column visibility.** Hidden columns live in the URL, so
     a breakpoint-driven default has to decide what beats what — a reader's
     explicit choice must survive a resize.
   - **`const EMPTY = "—"` is declared in eleven files.** It belongs in
     `lib/format.ts`; the sweep touches eleven screens and was not worth folding
     into this work.
10. **Two entity-ownership conflicts to settle before the modules that hit them.**
   Both module docs claim the same tables, and only one app can ship the
   migration:
   - `attendance` §15 and `hr-leave` §15 both claim `leave_types`,
     `leave_policies`, `leave_balances`, `leave_requests`, `leave_approvals`.
     Resolution: **attendance owns the tables and the student-leave endpoints;
     hr-leave (Tier 6) adds no tables** and layers the staff policy, accrual/
     carry-forward and configurable multi-step approval engine on top — which
     attendance §1 already says in prose. Record it in both docs when
     attendance lands.
   - `communication` §15 and `core/notifications` both cover `notifications`
     and `delivery_logs` — already resolved in PR 0 (see above), still to be
     written into `entities/communication.md`.

## Conventions worth re-reading before writing code

- Components resolve colour through `--sh-*` custom properties only — no literal hex, no
  `blue-600`. Tenant branding is the only thing that may override a `--sh-color-*`/
  `--sh-font-*`/`--sh-radius` value at runtime; the default is SchoolHub's own
  "Ink & Brass" platform brand — see the doc comment at the top of
  `packages/ui/src/styles/theme.css`. A `--sh-platform-*` tier is separate and
  never tenant-overridable at all.
- Chart colour comes from `--sh-color-chart-1..6` in fixed slot order, never cycled and
  never by rank. Bars/lines/stacks may use all six; scatter, bubble and small-multiples
  are capped at the first three (slot 4 collapses against slot 2 under protanopia). Status
  is never carried by a chart colour — it takes success/warning/danger with an icon and a
  label. The reasoning and the measured separations are in `theme.css`'s own header.
- `bg-spotlight` is allowed **once per screen**, on that screen's hero element. It is a
  named utility rather than an inline gradient specifically so a second use is greppable.
- A column sorts only if the endpoint declares the field in `ordering_fields`. The UI
  never sorts the rows it holds: one page of 25 out of 400 students reordered in the
  browser looks like a sort and is a lie. Relation sorts are `annotate()`d and ordered by
  the alias, never `campus__name` — `SELECT DISTINCT` plus an `ORDER BY` on a joined
  column is a 500 for any principal whose `scope_queryset` adds `.distinct()`.
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
